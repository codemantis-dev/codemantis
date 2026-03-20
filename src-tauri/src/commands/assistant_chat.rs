use crate::claude::session::AppState;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

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
    Cancelled {
        content: String,
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
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let event_name = format!("assistant-stream-{}", assistant_id);
    let client = reqwest::Client::new();

    // Create cancellation channel for this stream
    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut cancellers = state.assistant_cancellation.lock().await;
        cancellers.insert(assistant_id.clone(), cancel_tx);
    }

    let result = match provider.as_str() {
        "openai" => {
            stream_openai(&app_handle, &event_name, &client, &api_key, &model, &system_prompt, &messages, max_tokens, cancel_rx).await
        }
        "gemini" => {
            stream_gemini(&app_handle, &event_name, &client, &api_key, &model, &system_prompt, &messages, max_tokens, cancel_rx).await
        }
        "anthropic" => {
            stream_anthropic(&app_handle, &event_name, &client, &api_key, &model, &system_prompt, &messages, max_tokens, cancel_rx).await
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    };

    // Clean up cancellation sender
    {
        let mut cancellers = state.assistant_cancellation.lock().await;
        cancellers.remove(&assistant_id);
    }

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
    max_tokens: Option<u32>,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<(u32, u32), String> {
    let mut api_messages = vec![serde_json::json!({"role": "system", "content": system_prompt})];
    for msg in messages {
        api_messages.push(serde_json::json!({"role": msg.role, "content": openai_content(&msg.content)}));
    }

    let mut body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
        "stream_options": {"include_usage": true},
    });
    if let Some(mt) = max_tokens {
        body["max_completion_tokens"] = serde_json::json!(mt);
    }

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

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
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
                                if let Some(delta_text) = json["choices"][0]["delta"]["content"].as_str() {
                                    if !delta_text.is_empty() {
                                        full_text.push_str(delta_text);
                                        let _ = app.emit(event_name, StreamEvent::Delta {
                                            text: delta_text.to_string(),
                                        });
                                    }
                                }
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
                    Some(Err(e)) => return Err(format!("Stream read error: {}", e)),
                    None => break,
                }
            }
            _ = cancel_rx.changed() => {
                let _ = app.emit(event_name, StreamEvent::Cancelled { content: full_text.clone() });
                return Ok((input_tokens, output_tokens));
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
    max_tokens: Option<u32>,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<(u32, u32), String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
        model
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

    let mut body = serde_json::json!({
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
    });
    if let Some(mt) = max_tokens {
        body["generationConfig"] = serde_json::json!({"maxOutputTokens": mt});
    }

    let resp = client
        .post(&url)
        .header("x-goog-api-key", api_key)
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

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
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
                    Some(Err(e)) => return Err(format!("Stream read error: {}", e)),
                    None => break,
                }
            }
            _ = cancel_rx.changed() => {
                let _ = app.emit(event_name, StreamEvent::Cancelled { content: full_text.clone() });
                return Ok((input_tokens, output_tokens));
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
    max_tokens: Option<u32>,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<(u32, u32), String> {
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| serde_json::json!({"role": msg.role, "content": anthropic_content(&msg.content)}))
        .collect();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(8192),
        "system": system_prompt,
        "messages": api_messages,
        "stream": true,
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

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
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
                    Some(Err(e)) => return Err(format!("Stream read error: {}", e)),
                    None => break,
                }
            }
            _ = cancel_rx.changed() => {
                let _ = app.emit(event_name, StreamEvent::Cancelled { content: full_text.clone() });
                return Ok((input_tokens, output_tokens));
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

#[tauri::command]
pub async fn cancel_assistant_chat(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    let cancellers = state.assistant_cancellation.lock().await;
    if let Some(tx) = cancellers.get(&assistant_id) {
        let _ = tx.send(true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── openai_content ──

    #[test]
    fn openai_content_text_returns_json_string() {
        let content = ChatContent::Text("Hello world".to_string());
        let result = openai_content(&content);
        assert_eq!(result, json!("Hello world"));
    }

    #[test]
    fn openai_content_empty_text_returns_empty_string() {
        let content = ChatContent::Text("".to_string());
        let result = openai_content(&content);
        assert_eq!(result, json!(""));
    }

    #[test]
    fn openai_content_parts_text_only() {
        let content = ChatContent::Parts(vec![ContentPart::Text {
            text: "Hello".to_string(),
        }]);
        let result = openai_content(&content);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "Hello");
    }

    #[test]
    fn openai_content_parts_image_only() {
        let content = ChatContent::Parts(vec![ContentPart::Image {
            mime_type: "image/png".to_string(),
            data: "iVBOR".to_string(),
        }]);
        let result = openai_content(&content);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "image_url");
        let url = arr[0]["image_url"]["url"].as_str().unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(url.contains("iVBOR"));
    }

    #[test]
    fn openai_content_parts_mixed_text_and_image() {
        let content = ChatContent::Parts(vec![
            ContentPart::Text {
                text: "Look at this".to_string(),
            },
            ContentPart::Image {
                mime_type: "image/jpeg".to_string(),
                data: "abc123".to_string(),
            },
        ]);
        let result = openai_content(&content);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "Look at this");
        assert_eq!(arr[1]["type"], "image_url");
    }

    // ── gemini_parts ──

    #[test]
    fn gemini_parts_text_returns_text_part() {
        let content = ChatContent::Text("Hello".to_string());
        let result = gemini_parts(&content);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["text"], "Hello");
    }

    #[test]
    fn gemini_parts_image_returns_inline_data() {
        let content = ChatContent::Parts(vec![ContentPart::Image {
            mime_type: "image/png".to_string(),
            data: "base64data".to_string(),
        }]);
        let result = gemini_parts(&content);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["inlineData"]["mimeType"], "image/png");
        assert_eq!(result[0]["inlineData"]["data"], "base64data");
    }

    #[test]
    fn gemini_parts_mixed_text_and_image() {
        let content = ChatContent::Parts(vec![
            ContentPart::Text {
                text: "Describe".to_string(),
            },
            ContentPart::Image {
                mime_type: "image/webp".to_string(),
                data: "webpdata".to_string(),
            },
        ]);
        let result = gemini_parts(&content);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["text"], "Describe");
        assert_eq!(result[1]["inlineData"]["mimeType"], "image/webp");
    }

    // ── anthropic_content ──

    #[test]
    fn anthropic_content_text_returns_json_string() {
        let content = ChatContent::Text("Hello".to_string());
        let result = anthropic_content(&content);
        assert_eq!(result, json!("Hello"));
    }

    #[test]
    fn anthropic_content_parts_text_only() {
        let content = ChatContent::Parts(vec![ContentPart::Text {
            text: "Hi".to_string(),
        }]);
        let result = anthropic_content(&content);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "Hi");
    }

    #[test]
    fn anthropic_content_parts_image_has_base64_source() {
        let content = ChatContent::Parts(vec![ContentPart::Image {
            mime_type: "image/png".to_string(),
            data: "imgdata".to_string(),
        }]);
        let result = anthropic_content(&content);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "image");
        assert_eq!(arr[0]["source"]["type"], "base64");
        assert_eq!(arr[0]["source"]["media_type"], "image/png");
        assert_eq!(arr[0]["source"]["data"], "imgdata");
    }

    #[test]
    fn anthropic_content_parts_mixed() {
        let content = ChatContent::Parts(vec![
            ContentPart::Text {
                text: "Check this".to_string(),
            },
            ContentPart::Image {
                mime_type: "image/gif".to_string(),
                data: "gifdata".to_string(),
            },
        ]);
        let result = anthropic_content(&content);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[1]["type"], "image");
    }

    // ── ChatContent serde ──

    #[test]
    fn chat_content_text_deserializes_from_json_string() {
        let json_str = r#""Hello world""#;
        let content: ChatContent = serde_json::from_str(json_str).unwrap();
        match content {
            ChatContent::Text(s) => assert_eq!(s, "Hello world"),
            _ => panic!("Expected Text variant"),
        }
    }

    #[test]
    fn chat_content_parts_deserializes_from_json_array() {
        let json_str = r#"[{"type":"text","text":"Hello"},{"type":"image","mime_type":"image/png","data":"abc"}]"#;
        let content: ChatContent = serde_json::from_str(json_str).unwrap();
        match content {
            ChatContent::Parts(parts) => {
                assert_eq!(parts.len(), 2);
                match &parts[0] {
                    ContentPart::Text { text } => assert_eq!(text, "Hello"),
                    _ => panic!("Expected Text part"),
                }
                match &parts[1] {
                    ContentPart::Image { mime_type, data } => {
                        assert_eq!(mime_type, "image/png");
                        assert_eq!(data, "abc");
                    }
                    _ => panic!("Expected Image part"),
                }
            }
            _ => panic!("Expected Parts variant"),
        }
    }

    #[test]
    fn chat_content_text_round_trip() {
        let original = ChatContent::Text("round trip".to_string());
        let serialized = serde_json::to_string(&original).unwrap();
        let deserialized: ChatContent = serde_json::from_str(&serialized).unwrap();
        match deserialized {
            ChatContent::Text(s) => assert_eq!(s, "round trip"),
            _ => panic!("Expected Text variant after round trip"),
        }
    }

    // ── StreamEvent serialization ──

    #[test]
    fn stream_event_cancelled_serializes_correctly() {
        let event = StreamEvent::Cancelled { content: "partial".to_string() };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "cancelled");
        assert_eq!(json["content"], "partial");
    }

    #[test]
    fn chat_content_parts_round_trip() {
        let original = ChatContent::Parts(vec![
            ContentPart::Text {
                text: "hello".to_string(),
            },
            ContentPart::Image {
                mime_type: "image/jpeg".to_string(),
                data: "data123".to_string(),
            },
        ]);
        let serialized = serde_json::to_string(&original).unwrap();
        let deserialized: ChatContent = serde_json::from_str(&serialized).unwrap();
        match deserialized {
            ChatContent::Parts(parts) => {
                assert_eq!(parts.len(), 2);
            }
            _ => panic!("Expected Parts variant after round trip"),
        }
    }
}
