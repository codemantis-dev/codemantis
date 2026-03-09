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
}

const DEFAULT_SYSTEM_PROMPT: &str = r#"Summarize this coding session turn as a changelog entry. Return JSON only, no markdown.

JSON format: {"headline":"max 80 chars","description":"1-2 sentences","category":"feature|bugfix|refactor|docs|config|test|plan"}

Use category "plan" when the session is in plan mode (architecture planning, implementation design, no actual code changes being committed)."#;

fn build_prompt(request: &SummarizeRequest) -> String {
    let tools_str = request.tools_used.join(", ");
    let mode_hint = if request.session_mode == "plan" {
        "\nSession mode: PLAN MODE (this is a planning/architecture session, use category \"plan\")"
    } else {
        ""
    };
    format!(
        "User request: {}\nActions taken: {}\nResult summary: {}{}",
        &request.user_prompt[..request.user_prompt.len().min(200)],
        &tools_str[..tools_str.len().min(300)],
        &request.assistant_summary[..request.assistant_summary.len().min(300)],
        mode_hint
    )
}

pub async fn summarize_turn(
    provider: &str,
    api_key: &str,
    request: &SummarizeRequest,
    custom_prompt: Option<&str>,
) -> Result<SummarizeResponse, String> {
    let prompt = build_prompt(request);
    let system_prompt = custom_prompt
        .filter(|p| !p.trim().is_empty())
        .unwrap_or(DEFAULT_SYSTEM_PROMPT);
    let client = reqwest::Client::new();

    let response_text = match provider {
        "gemini" => call_gemini(&client, api_key, system_prompt, &prompt).await?,
        "openai" => call_openai(&client, api_key, system_prompt, &prompt).await?,
        "anthropic" => call_anthropic(&client, api_key, system_prompt, &prompt).await?,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    parse_response(&response_text)
}

pub async fn test_api_key(provider: &str, api_key: &str) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let test_prompt = "Say hello in one word. Return JSON: {\"headline\":\"test\",\"description\":\"test\",\"category\":\"feature\"}";

    let result = match provider {
        "gemini" => call_gemini(&client, api_key, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
        "openai" => call_openai(&client, api_key, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
        "anthropic" => call_anthropic(&client, api_key, DEFAULT_SYSTEM_PROMPT, test_prompt).await,
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
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={}",
        api_key
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
            "maxOutputTokens": 256,
            "responseMimeType": "application/json"
        }
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

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gemini response parse failed: {}", e))?;

    json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Gemini response".to_string())
}

async fn call_openai(
    client: &reqwest::Client,
    api_key: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "gpt-4.1-mini",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 256,
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

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenAI response".to_string())
}

async fn call_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 256,
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

    json["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Anthropic response".to_string())
}

fn parse_response(text: &str) -> Result<SummarizeResponse, String> {
    // Try direct parse first
    if let Ok(resp) = serde_json::from_str::<SummarizeResponse>(text) {
        return Ok(validate_response(resp));
    }

    // Try to extract JSON from the text (in case there's surrounding text)
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            let json_str = &text[start..=end];
            if let Ok(resp) = serde_json::from_str::<SummarizeResponse>(json_str) {
                return Ok(validate_response(resp));
            }
        }
    }

    Err(format!("Failed to parse AI response as JSON: {}", text))
}

fn validate_response(mut resp: SummarizeResponse) -> SummarizeResponse {
    // Truncate headline to 80 chars
    if resp.headline.len() > 80 {
        resp.headline = resp.headline[..80].to_string();
    }

    // Validate category
    let valid_categories = ["feature", "bugfix", "refactor", "docs", "config", "test", "plan"];
    if !valid_categories.contains(&resp.category.as_str()) {
        resp.category = "feature".to_string();
    }

    resp
}
