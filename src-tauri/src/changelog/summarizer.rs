use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizeRequest {
    pub user_prompt: String,
    pub assistant_summary: String,
    pub tools_used: Vec<String>,
    pub session_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizeResponse {
    pub headline: String,
    pub description: String,
    pub category: String,
    pub technical_details: String,
    pub tools_summary: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

const DEFAULT_SYSTEM_PROMPT: &str = r#"Summarize this coding session turn as a detailed changelog entry. Return JSON only, no markdown.

JSON format:
{
  "headline": "max 80 chars — concise summary of what was accomplished",
  "description": "2-4 sentences explaining what was done and why, with enough context that someone reading the changelog later can understand the change without looking at the code",
  "category": "feature|bugfix|refactor|docs|config|test|plan",
  "technical_details": "Bullet-point list (each starting with '• ') of specific technical changes made: files created/modified, functions added/changed, key implementation decisions. 3-8 bullets.",
  "tools_summary": "Brief count of operations, e.g. '3 files edited, 1 file created, 2 bash commands'"
}

Guidelines:
- Use category "plan" when the session is in plan mode (architecture planning, implementation design, no actual code changes being committed)
- For description: explain the WHY and WHAT, not just tool operations. What problem was solved? What capability was added?
- For technical_details: be specific about file names, function names, component names. Each bullet should convey one discrete change.
- For tools_summary: summarize the scope of work (how many files touched, how many operations)"#;

fn build_prompt(request: &SummarizeRequest) -> String {
    let tools_str = request.tools_used.join("\n");
    let mode_hint = if request.session_mode == "plan" {
        "\nSession mode: PLAN MODE (this is a planning/architecture session, use category \"plan\")"
    } else {
        ""
    };
    format!(
        "User request: {}\n\nTool operations performed:\n{}\n\nAssistant summary: {}{}",
        &request.user_prompt[..request.user_prompt.len().min(500)],
        &tools_str[..tools_str.len().min(2000)],
        &request.assistant_summary[..request.assistant_summary.len().min(800)],
        mode_hint
    )
}

pub async fn summarize_turn(
    provider: &str,
    api_key: &str,
    model: &str,
    request: &SummarizeRequest,
    custom_prompt: Option<&str>,
) -> Result<SummarizeResponse, String> {
    let prompt = build_prompt(request);
    let system_prompt = custom_prompt
        .filter(|p| !p.trim().is_empty())
        .unwrap_or(DEFAULT_SYSTEM_PROMPT);
    let client = reqwest::Client::new();

    let (response_text, input_tokens, output_tokens) = match provider {
        "gemini" => call_gemini(&client, api_key, model, system_prompt, &prompt).await?,
        "openai" => call_openai(&client, api_key, model, system_prompt, &prompt).await?,
        "anthropic" => call_anthropic(&client, api_key, model, system_prompt, &prompt).await?,
        "openrouter" => call_openrouter(&client, api_key, model, system_prompt, &prompt).await?,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let mut resp = parse_response(&response_text)?;
    resp.input_tokens = input_tokens;
    resp.output_tokens = output_tokens;
    Ok(resp)
}

pub async fn test_api_key(provider: &str, api_key: &str, model: &str) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let test_prompt = "Say hello in one word. Return JSON: {\"headline\":\"test\",\"description\":\"test\",\"category\":\"feature\",\"technical_details\":\"\",\"tools_summary\":\"\"}";

    let result = match provider {
        "gemini" => call_gemini(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
        "openai" => call_openai(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
        "anthropic" => call_anthropic(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
        "openrouter" => call_openrouter(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    match result {
        Ok(_) => Ok(true),
        Err(e) => {
            log::warn!("API key test failed for {}: {}", provider, e);
            Ok(false)
        }
    }
}

async fn call_gemini(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<(String, u32, u32), String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    let body = serde_json::json!({
        "system_instruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json"
        }
    });

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

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gemini response parse failed: {}", e))?;

    let text = json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Gemini response".to_string())?;

    let input_tokens = json["usageMetadata"]["promptTokenCount"].as_u64().unwrap_or_else(|| {
        log::warn!("Gemini response missing promptTokenCount");
        0
    }) as u32;
    let output_tokens = json["usageMetadata"]["candidatesTokenCount"].as_u64().unwrap_or_else(|| {
        log::warn!("Gemini response missing candidatesTokenCount");
        0
    }) as u32;

    Ok((text, input_tokens, output_tokens))
}

async fn call_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<(String, u32, u32), String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_completion_tokens": 1024,
        "response_format": {"type": "json_object"}
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

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OpenAI response parse failed: {}", e))?;

    let text = json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenAI response".to_string())?;

    let input_tokens = json["usage"]["prompt_tokens"].as_u64().unwrap_or_else(|| {
        log::warn!("OpenAI response missing prompt_tokens");
        0
    }) as u32;
    let output_tokens = json["usage"]["completion_tokens"].as_u64().unwrap_or_else(|| {
        log::warn!("OpenAI response missing completion_tokens");
        0
    }) as u32;

    Ok((text, input_tokens, output_tokens))
}

async fn call_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<(String, u32, u32), String> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
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

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Anthropic response parse failed: {}", e))?;

    let text = json["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Anthropic response".to_string())?;

    let input_tokens = json["usage"]["input_tokens"].as_u64().unwrap_or_else(|| {
        log::warn!("Anthropic response missing input_tokens");
        0
    }) as u32;
    let output_tokens = json["usage"]["output_tokens"].as_u64().unwrap_or_else(|| {
        log::warn!("Anthropic response missing output_tokens");
        0
    }) as u32;

    Ok((text, input_tokens, output_tokens))
}

async fn call_openrouter(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<(String, u32, u32), String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_completion_tokens": 1024,
        "response_format": {"type": "json_object"}
    });

    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(api_key)
        .header("HTTP-Referer", "https://codemantis.dev")
        .header("X-Title", "CodeMantis")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenRouter API error {}: {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OpenRouter response parse failed: {}", e))?;

    let text = json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenRouter response".to_string())?;

    let input_tokens = json["usage"]["prompt_tokens"].as_u64().unwrap_or_else(|| {
        log::warn!("OpenRouter response missing prompt_tokens");
        0
    }) as u32;
    let output_tokens = json["usage"]["completion_tokens"].as_u64().unwrap_or_else(|| {
        log::warn!("OpenRouter response missing completion_tokens");
        0
    }) as u32;

    Ok((text, input_tokens, output_tokens))
}

/// Intermediate struct for deserializing the JSON response (without token fields)
#[derive(Debug, Deserialize)]
struct RawSummarizeResponse {
    headline: String,
    description: String,
    category: String,
    #[serde(default)]
    technical_details: String,
    #[serde(default)]
    tools_summary: String,
}

fn parse_response(text: &str) -> Result<SummarizeResponse, String> {
    // Try direct parse first
    if let Ok(resp) = serde_json::from_str::<RawSummarizeResponse>(text) {
        return Ok(validate_response(resp));
    }

    // Try to extract JSON from the text (in case there's surrounding text)
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            let json_str = &text[start..=end];
            if let Ok(resp) = serde_json::from_str::<RawSummarizeResponse>(json_str) {
                return Ok(validate_response(resp));
            }
        }
    }

    Err(format!("Failed to parse AI response as JSON: {}", text))
}

fn validate_response(raw: RawSummarizeResponse) -> SummarizeResponse {
    let mut headline = raw.headline;
    if headline.len() > 80 {
        headline = headline[..80].to_string();
    }

    let mut category = raw.category;
    let valid_categories = ["feature", "bugfix", "refactor", "docs", "config", "test", "plan"];
    if !valid_categories.contains(&category.as_str()) {
        category = "feature".to_string();
    }

    SummarizeResponse {
        headline,
        description: raw.description,
        category,
        technical_details: raw.technical_details,
        tools_summary: raw.tools_summary,
        input_tokens: 0,
        output_tokens: 0,
    }
}
