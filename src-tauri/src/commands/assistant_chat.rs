use crate::claude::session::AppState;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: ChatContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { mime_type: String, data: String },
}

// --- Provider-specific content formatting helpers ---

fn openai_content(content: &ChatContent) -> serde_json::Value {
    match content {
        ChatContent::Text(s) => serde_json::json!(s),
        ChatContent::Parts(parts) => {
            let arr: Vec<serde_json::Value> = parts
                .iter()
                .map(|p| match p {
                    ContentPart::Text { text } => {
                        serde_json::json!({"type": "text", "text": text})
                    }
                    ContentPart::Image { mime_type, data } => {
                        serde_json::json!({
                            "type": "image_url",
                            "image_url": { "url": format!("data:{};base64,{}", mime_type, data) }
                        })
                    }
                })
                .collect();
            serde_json::json!(arr)
        }
    }
}

fn gemini_parts(content: &ChatContent) -> Vec<serde_json::Value> {
    match content {
        ChatContent::Text(s) => vec![serde_json::json!({"text": s})],
        ChatContent::Parts(parts) => parts
            .iter()
            .map(|p| match p {
                ContentPart::Text { text } => serde_json::json!({"text": text}),
                ContentPart::Image { mime_type, data } => {
                    serde_json::json!({"inlineData": {"mimeType": mime_type, "data": data}})
                }
            })
            .collect(),
    }
}

fn anthropic_content(content: &ChatContent) -> serde_json::Value {
    match content {
        ChatContent::Text(s) => serde_json::json!(s),
        ChatContent::Parts(parts) => {
            let arr: Vec<serde_json::Value> = parts
                .iter()
                .map(|p| match p {
                    ContentPart::Text { text } => {
                        serde_json::json!({"type": "text", "text": text})
                    }
                    ContentPart::Image { mime_type, data } => {
                        serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": data
                            }
                        })
                    }
                })
                .collect();
            serde_json::json!(arr)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Delta {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        content: String,
        input_tokens: u32,
        output_tokens: u32,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
pub async fn send_assistant_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    assistant_id: String,
    provider: String,
    api_key: String,
    model: String,
    system_prompt: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let event_name = format!("assistant-stream-{}", assistant_id);
    let client = reqwest::Client::new();

    let result = match provider.as_str() {
        "openai" => {
            stream_openai(&app_handle, &event_name, &client, &api_key, &model, &system_prompt, &messages).await
        }
        "gemini" => {
            stream_gemini(&app_handle, &event_name, &client, &api_key, &model, &system_prompt, &messages).await
        }
        "anthropic" => {
            stream_anthropic(&app_handle, &event_name, &client, &api_key, &model, &system_prompt, &messages).await
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    };

    // Log the API call regardless of success/failure
    log::info!(
        "[assistant_chat] provider={}, model={}, result={}",
        provider,
        model,
        if result.is_ok() { "ok" } else { "err" }
    );
    let timestamp = chrono::Utc::now().to_rfc3339();
    let log_id = uuid::Uuid::new_v4().to_string();
    let (success, error_msg, input_tokens, output_tokens) = match &result {
        Ok((it, ot)) => (true, None, *it, *ot),
        Err(e) => (false, Some(e.clone()), 0, 0),
    };
    let app_settings = crate::commands::settings::get_settings().unwrap_or_default();
    let cost = if let Some(pricing) = app_settings.model_pricing.get(&model) {
        (input_tokens as f64 / 1_000_000.0 * pricing.input)
            + (output_tokens as f64 / 1_000_000.0 * pricing.output)
    } else {
        0.0
    };
    let db = &state.database;
    if let Err(e) = db.insert_api_log(
        &log_id,
        &timestamp,
        &provider,
        &model,
        &assistant_id,
        input_tokens,
        output_tokens,
        cost,
        success,
        error_msg.as_deref(),
    ) {
        log::error!("[assistant_chat] Failed to insert API log: {}", e);
    } else {
        log::info!(
            "[assistant_chat] Logged API call: provider={}, model={}, tokens={}/{}, cost={:.6}",
            provider, model, input_tokens, output_tokens, cost
        );
    }

    if let Err(e) = result {
        let _ = app_handle.emit(&event_name, StreamEvent::Error { message: e.clone() });
        return Err(e);
    }

    Ok(())
}

// --- OpenAI SSE streaming ---

async fn stream_openai(
    app: &AppHandle,
    event_name: &str,
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    messages: &[ChatMessage],
) -> Result<(u32, u32), String> {
    let mut api_messages = vec![serde_json::json!({"role": "system", "content": system_prompt})];
    for msg in messages {
        api_messages.push(serde_json::json!({"role": msg.role, "content": openai_content(&msg.content)}));
    }

    let body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
        "stream_options": {"include_usage": true},
        "temperature": 0.7,
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, text));
    }

    let mut full_text = String::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut line_buffer = String::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        line_buffer.push_str(&text);

        while let Some(pos) = line_buffer.find('\n') {
            let line = line_buffer[..pos].trim().to_string();
            line_buffer = line_buffer[pos + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                // Extract content delta
                if let Some(delta_text) = json["choices"][0]["delta"]["content"].as_str() {
                    if !delta_text.is_empty() {
                        full_text.push_str(delta_text);
                        let _ = app.emit(event_name, StreamEvent::Delta {
                            text: delta_text.to_string(),
                        });
                    }
                }
                // Extract usage from final chunk (stream_options.include_usage)
                if let Some(usage) = json.get("usage") {
                    if let Some(pt) = usage["prompt_tokens"].as_u64() {
                        input_tokens = pt as u32;
                    }
                    if let Some(ct) = usage["completion_tokens"].as_u64() {
                        output_tokens = ct as u32;
                    }
                }
            }
        }
    }

    let _ = app.emit(event_name, StreamEvent::Done {
        content: full_text,
        input_tokens,
        output_tokens,
    });

    Ok((input_tokens, output_tokens))
}

// --- Gemini SSE streaming ---

async fn stream_gemini(
    app: &AppHandle,
    event_name: &str,
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    messages: &[ChatMessage],
) -> Result<(u32, u32), String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        model, api_key
    );

    let contents: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| {
            let role = if msg.role == "assistant" { "model" } else { &msg.role };
            serde_json::json!({
                "role": role,
                "parts": gemini_parts(&msg.content)
            })
        })
        .collect();

    let body = serde_json::json!({
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.7}
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, text));
    }

    let mut full_text = String::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut line_buffer = String::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        line_buffer.push_str(&text);

        while let Some(pos) = line_buffer.find('\n') {
            let line = line_buffer[..pos].trim().to_string();
            line_buffer = line_buffer[pos + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(part_text) = json["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                    if !part_text.is_empty() {
                        full_text.push_str(part_text);
                        let _ = app.emit(event_name, StreamEvent::Delta {
                            text: part_text.to_string(),
                        });
                    }
                }
                // Token usage
                if let Some(usage) = json.get("usageMetadata") {
                    if let Some(pt) = usage["promptTokenCount"].as_u64() {
                        input_tokens = pt as u32;
                    }
                    if let Some(ct) = usage["candidatesTokenCount"].as_u64() {
                        output_tokens = ct as u32;
                    }
                }
            }
        }
    }

    let _ = app.emit(event_name, StreamEvent::Done {
        content: full_text,
        input_tokens,
        output_tokens,
    });

    Ok((input_tokens, output_tokens))
}

// --- Anthropic SSE streaming ---

async fn stream_anthropic(
    app: &AppHandle,
    event_name: &str,
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    messages: &[ChatMessage],
) -> Result<(u32, u32), String> {
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| serde_json::json!({"role": msg.role, "content": anthropic_content(&msg.content)}))
        .collect();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": api_messages,
        "stream": true,
        "temperature": 0.7,
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, text));
    }

    let mut full_text = String::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut line_buffer = String::new();
    let mut current_event_type = String::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        line_buffer.push_str(&text);

        while let Some(pos) = line_buffer.find('\n') {
            let line = line_buffer[..pos].trim().to_string();
            line_buffer = line_buffer[pos + 1..].to_string();

            if line.starts_with("event: ") {
                current_event_type = line[7..].to_string();
                continue;
            }

            if !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                match current_event_type.as_str() {
                    "content_block_delta" => {
                        if let Some(delta_text) = json["delta"]["text"].as_str() {
                            if !delta_text.is_empty() {
                                full_text.push_str(delta_text);
                                let _ = app.emit(event_name, StreamEvent::Delta {
                                    text: delta_text.to_string(),
                                });
                            }
                        }
                    }
                    "message_start" => {
                        if let Some(usage) = json["message"]["usage"].as_object() {
                            if let Some(it) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                                input_tokens = it as u32;
                            }
                        }
                    }
                    "message_delta" => {
                        if let Some(usage) = json.get("usage") {
                            if let Some(ot) = usage["output_tokens"].as_u64() {
                                output_tokens = ot as u32;
                            }
                        }
                    }
                    _ => {}
                }
            }
            current_event_type.clear();
        }
    }

    let _ = app.emit(event_name, StreamEvent::Done {
        content: full_text,
        input_tokens,
        output_tokens,
    });

    Ok((input_tokens, output_tokens))
}
