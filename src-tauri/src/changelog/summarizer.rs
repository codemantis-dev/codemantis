use serde::{Deserialize, Serialize};

/// Extract a clean error message from an API error response body.
/// Handles JSON error objects, HTML WAF pages, and raw text.
fn extract_api_error(provider: &str, status: reqwest::StatusCode, body: &str) -> String {
    // Try OpenRouter/OpenAI JSON error format: {"error":{"message":"...","code":...}}
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = json["error"]["message"].as_str() {
            let code = json["error"]["code"]
                .as_u64()
                .unwrap_or(status.as_u16() as u64);
            let clean = if msg.len() > 300 { &msg[..300] } else { msg };
            return format!("{} API error {}: {}", provider, code, clean);
        }
    }
    // If body looks like HTML (e.g. WAF error page), extract <title>
    let lower = body.to_lowercase();
    if lower.starts_with("<!doctype") || lower.starts_with("<html") {
        if let Some(start) = lower.find("<title>") {
            if let Some(end) = lower[start..].find("</title>") {
                let title = &body[start + 7..start + end];
                return format!(
                    "{} API error {}: Provider returned error page ({})",
                    provider, status, title.trim()
                );
            }
        }
        return format!(
            "{} API error {}: Provider returned HTML error page",
            provider, status
        );
    }
    // Fallback: truncate raw body
    let truncated = if body.len() > 500 { &body[..500] } else { body };
    format!("{} API error {}: {}", provider, status, truncated)
}

/// Normalize a thinking-level string to one of `off | low | medium | high`.
/// Unknown / empty values fall back to `off` (the safe, cheapest default).
/// Used by the per-provider body builders to set provider-native reasoning
/// controls. Recall threads its `enricher_thinking`/`harvester_thinking`
/// config here; the changelog summarizer passes `"off"`.
pub(crate) fn normalize_thinking(level: &str) -> &'static str {
    match level.trim().to_ascii_lowercase().as_str() {
        "low" => "low",
        "medium" => "medium",
        "high" => "high",
        _ => "off",
    }
}

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

    // Changelog summaries don't use extended thinking — fast JSON is the goal.
    let (response_text, input_tokens, output_tokens) = match provider {
        "gemini" => call_gemini(&client, api_key, model, system_prompt, &prompt, "off").await?,
        "openai" => call_openai(&client, api_key, model, system_prompt, &prompt, "off").await?,
        "anthropic" => call_anthropic(&client, api_key, model, system_prompt, &prompt, "off").await?,
        "openrouter" => call_openrouter(&client, api_key, model, system_prompt, &prompt).await?,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let mut resp = parse_response(&response_text)?;
    resp.input_tokens = input_tokens;
    resp.output_tokens = output_tokens;
    Ok(resp)
}

/// Generic provider dispatch for a raw system + user prompt. Reused by the
/// Duo-Coding analyst (and any future structured-output caller) so outbound
/// LLM plumbing lives in ONE place. Returns `(response_text, input_tokens,
/// output_tokens)`. Honors extended thinking where the provider supports it
/// (`"off" | "low" | "medium" | "high"`); OpenRouter ignores `thinking`.
/// Never sends `temperature` — Opus 4.x and GPT-5/o-series reject it.
pub async fn call_provider(
    provider: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    thinking: &str,
) -> Result<(String, u32, u32), String> {
    let client = reqwest::Client::new();
    match provider {
        "gemini" => call_gemini(&client, api_key, model, system_prompt, user_prompt, thinking).await,
        "openai" => call_openai(&client, api_key, model, system_prompt, user_prompt, thinking).await,
        "anthropic" => {
            call_anthropic(&client, api_key, model, system_prompt, user_prompt, thinking).await
        }
        "openrouter" => call_openrouter(&client, api_key, model, system_prompt, user_prompt).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Result of [`summarize_conversation`] — a plain-text recap plus token
/// counts so the command layer can log the API call.
#[derive(Debug, Clone)]
pub struct ConversationRecap {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

const RECAP_SYSTEM_PROMPT: &str = r#"You are summarizing a coding-assistant conversation so the work can continue in a FRESH context window (the previous context was lost to a failed compaction).

Write a concise but complete recap as plain text (NOT JSON, NOT markdown headings). Cover:
- The overall goal / task being worked on.
- Key decisions, constraints, and conclusions reached.
- The current state: what is done, what is in progress, and the immediate next step.
- Any important file paths, function/component names, or commands that matter for continuing.

Be specific and information-dense. Omit pleasantries and filler. Aim for at most ~400 words. Start directly with the recap."#;

/// Summarize a full conversation transcript into a plain-text recap used to
/// prime a fresh Codex thread after a failed compaction. Reuses the same
/// per-provider callers as [`summarize_turn`]; returns the raw recap text
/// (not the changelog JSON shape).
pub async fn summarize_conversation(
    provider: &str,
    api_key: &str,
    model: &str,
    transcript: &str,
) -> Result<ConversationRecap, String> {
    let client = reqwest::Client::new();
    let prompt = format!("Conversation transcript:\n\n{transcript}");

    let (response_text, input_tokens, output_tokens) = match provider {
        "gemini" => call_gemini(&client, api_key, model, RECAP_SYSTEM_PROMPT, &prompt, "off").await?,
        "openai" => call_openai(&client, api_key, model, RECAP_SYSTEM_PROMPT, &prompt, "off").await?,
        "anthropic" => call_anthropic(&client, api_key, model, RECAP_SYSTEM_PROMPT, &prompt, "off").await?,
        "openrouter" => call_openrouter(&client, api_key, model, RECAP_SYSTEM_PROMPT, &prompt).await?,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let text = response_text.trim().to_string();
    if text.is_empty() {
        return Err("recap summary was empty".to_string());
    }
    Ok(ConversationRecap {
        text,
        input_tokens,
        output_tokens,
    })
}

pub async fn test_api_key(provider: &str, api_key: &str, model: &str) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let test_prompt = "Say hello in one word. Return JSON: {\"headline\":\"test\",\"description\":\"test\",\"category\":\"feature\",\"technical_details\":\"\",\"tools_summary\":\"\"}";

    let result = match provider {
        "gemini" => call_gemini(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt, "off").await,
        "openai" => call_openai(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt, "off").await,
        "anthropic" => call_anthropic(&client, api_key, model, DEFAULT_SYSTEM_PROMPT, test_prompt, "off").await,
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

/// Build the Gemini request body. `thinking` controls the
/// `thinkingConfig.thinkingBudget` — critically, `off` sets it to `0`,
/// which *forces thinking off even on thinking-default models* (e.g.
/// gemini-3.5-flash), so reasoning tokens don't starve the output budget
/// and truncate the JSON. Higher levels raise both the thinking budget
/// and `maxOutputTokens` so the answer still fits.
fn build_gemini_body(model: &str, system_prompt: &str, prompt: &str, thinking: &str) -> serde_json::Value {
    let _ = model; // model is in the URL, not the body; kept for signature parity
    let (thinking_budget, max_output) = match normalize_thinking(thinking) {
        "low" => (2048, 4096),
        "medium" => (8192, 12288),
        "high" => (16384, 24576),
        _ => (0, 1024), // off
    };
    serde_json::json!({
        "system_instruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": max_output,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": thinking_budget}
        }
    })
}

pub(crate) async fn call_gemini(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
    thinking: &str,
) -> Result<(String, u32, u32), String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    let body = build_gemini_body(model, system_prompt, prompt, thinking);

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

fn build_openai_body(model: &str, system_prompt: &str, prompt: &str, thinking: &str) -> serde_json::Value {
    // NOTE: Do not send `temperature` — GPT-5 family and reasoning models (o1/o3/o4)
    // reject non-default temperature with HTTP 400 ("Only the default (1) is supported").
    // `response_format: json_object` keeps output deterministic enough.
    //
    // `reasoning_effort` is the GPT-5 family's reasoning control. `off` maps
    // to "minimal" (the lowest setting — GPT-5 has no true "none"), keeping
    // latency/cost down and leaving the token budget for the answer. Higher
    // levels raise both the effort and `max_completion_tokens` (reasoning
    // tokens count against it).
    let (effort, max_completion) = match normalize_thinking(thinking) {
        "low" => ("low", 4096),
        "medium" => ("medium", 8192),
        "high" => ("high", 16384),
        _ => ("minimal", 1024), // off
    };
    serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "max_completion_tokens": max_completion,
        "reasoning_effort": effort,
        "response_format": {"type": "json_object"}
    })
}

pub(crate) async fn call_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
    thinking: &str,
) -> Result<(String, u32, u32), String> {
    let body = build_openai_body(model, system_prompt, prompt, thinking);

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

fn build_anthropic_body(model: &str, system_prompt: &str, prompt: &str, thinking: &str) -> serde_json::Value {
    // NOTE: Do not send `temperature` — Anthropic deprecated it for newer models
    // (e.g. Opus 4.8 returns 400 "`temperature` is deprecated for this model").
    // The "must return JSON" prompt is enough to keep output deterministic.
    //
    // Anthropic models don't reason unless asked, so `off` omits the
    // `thinking` block entirely (unchanged behaviour). Higher levels enable
    // extended thinking with a token budget; `max_tokens` must exceed the
    // thinking budget, so we add headroom for the answer on top.
    let budget = match normalize_thinking(thinking) {
        "low" => 2048,
        "medium" => 8192,
        "high" => 16384,
        _ => 0, // off
    };
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": if budget > 0 { budget + 4096 } else { 1024 },
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    });
    if budget > 0 {
        body["thinking"] = serde_json::json!({"type": "enabled", "budget_tokens": budget});
    }
    body
}

pub(crate) async fn call_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
    thinking: &str,
) -> Result<(String, u32, u32), String> {
    let body = build_anthropic_body(model, system_prompt, prompt, thinking);

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

fn build_openrouter_body(model: &str, system_prompt: &str, prompt: &str) -> serde_json::Value {
    // NOTE: Do not send `temperature` — OpenRouter forwards to the underlying model,
    // and Anthropic Opus 4.8 / OpenAI GPT-5 family reject it with HTTP 400.
    // The "must return JSON" prompt keeps output deterministic enough for changelog summaries.
    serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "max_completion_tokens": 1024
    })
}

pub(crate) async fn call_openrouter(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<(String, u32, u32), String> {
    let body = build_openrouter_body(model, system_prompt, prompt);

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
        return Err(extract_api_error("OpenRouter", status, &text));
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

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    // ── extract_api_error ────────────────────────────────────────────────

    #[test]
    fn test_extract_api_error_json_format() {
        let body = r#"{"error":{"message":"rate limited","code":429}}"#;
        let result = extract_api_error("OpenRouter", StatusCode::TOO_MANY_REQUESTS, body);
        assert!(result.contains("OpenRouter API error 429"));
        assert!(result.contains("rate limited"));
    }

    #[test]
    fn test_extract_api_error_json_without_code_uses_status() {
        let body = r#"{"error":{"message":"something went wrong"}}"#;
        let result = extract_api_error("OpenAI", StatusCode::INTERNAL_SERVER_ERROR, body);
        assert!(result.contains("OpenAI API error 500"));
        assert!(result.contains("something went wrong"));
    }

    #[test]
    fn test_extract_api_error_html_with_title() {
        let body = r#"<!DOCTYPE html><html><head><title>Access Denied</title></head><body>Blocked</body></html>"#;
        let result = extract_api_error("Gemini", StatusCode::FORBIDDEN, body);
        assert!(result.contains("Gemini API error 403"));
        assert!(result.contains("Access Denied"));
        assert!(result.contains("error page"));
    }

    #[test]
    fn test_extract_api_error_html_without_title() {
        let body = r#"<html><body>Error</body></html>"#;
        let result = extract_api_error("Anthropic", StatusCode::BAD_GATEWAY, body);
        assert!(result.contains("Anthropic API error 502"));
        assert!(result.contains("HTML error page"));
    }

    #[test]
    fn test_extract_api_error_raw_text() {
        let body = "Service temporarily unavailable";
        let result = extract_api_error("OpenRouter", StatusCode::SERVICE_UNAVAILABLE, body);
        assert!(result.contains("OpenRouter API error 503"));
        assert!(result.contains("Service temporarily unavailable"));
    }

    #[test]
    fn test_extract_api_error_truncates_long_json_message() {
        let long_msg = "x".repeat(500);
        let body = format!(r#"{{"error":{{"message":"{}"}}}}"#, long_msg);
        let result = extract_api_error("OpenAI", StatusCode::BAD_REQUEST, &body);
        // Message should be truncated to 300 chars
        assert!(result.len() < body.len());
        // The error message portion should be at most 300 chars
        let msg_part = result.split(": ").last().unwrap();
        assert!(msg_part.len() <= 300);
    }

    #[test]
    fn test_extract_api_error_truncates_long_raw_body() {
        let long_body = "y".repeat(1000);
        let result = extract_api_error("Gemini", StatusCode::BAD_REQUEST, &long_body);
        // Raw body truncated to 500 chars plus prefix
        let raw_part = result.split(": ").last().unwrap();
        assert!(raw_part.len() <= 500);
    }

    // ── summarize_conversation (recap) ───────────────────────────────────

    #[tokio::test]
    async fn summarize_conversation_rejects_unknown_provider() {
        // Unknown provider short-circuits BEFORE any network call, so this is a
        // cheap, deterministic unit test of the routing.
        let result =
            summarize_conversation("not-a-provider", "key", "model", "User: hi").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown provider"));
    }

    // ── build_prompt ─────────────────────────────────────────────────────

    #[test]
    fn test_build_prompt_includes_user_prompt_and_summary() {
        let request = SummarizeRequest {
            user_prompt: "Fix the login bug".to_string(),
            assistant_summary: "I fixed the authentication flow".to_string(),
            tools_used: vec!["Read file: auth.rs".to_string()],
            session_mode: "normal".to_string(),
        };

        let prompt = build_prompt(&request);
        assert!(prompt.contains("Fix the login bug"));
        assert!(prompt.contains("I fixed the authentication flow"));
        assert!(prompt.contains("Read file: auth.rs"));
    }

    #[test]
    fn test_build_prompt_truncates_long_inputs() {
        let request = SummarizeRequest {
            user_prompt: "a".repeat(1000),
            assistant_summary: "b".repeat(2000),
            tools_used: vec!["c".repeat(5000)],
            session_mode: "normal".to_string(),
        };

        let prompt = build_prompt(&request);
        // user_prompt truncated to 500
        assert!(!prompt.contains(&"a".repeat(501)));
        // assistant_summary truncated to 800
        assert!(!prompt.contains(&"b".repeat(801)));
        // tools truncated to 2000
        assert!(!prompt.contains(&"c".repeat(2001)));
    }

    #[test]
    fn test_build_prompt_plan_mode_hint() {
        let request = SummarizeRequest {
            user_prompt: "Plan the refactor".to_string(),
            assistant_summary: "Here is the plan".to_string(),
            tools_used: vec![],
            session_mode: "plan".to_string(),
        };

        let prompt = build_prompt(&request);
        assert!(prompt.contains("PLAN MODE"));
        assert!(prompt.contains("category \"plan\""));
    }

    #[test]
    fn test_build_prompt_no_plan_hint_for_normal_mode() {
        let request = SummarizeRequest {
            user_prompt: "Add a button".to_string(),
            assistant_summary: "Added the button".to_string(),
            tools_used: vec![],
            session_mode: "normal".to_string(),
        };

        let prompt = build_prompt(&request);
        assert!(!prompt.contains("PLAN MODE"));
    }

    // ── parse_response ───────────────────────────────────────────────────

    #[test]
    fn test_parse_response_valid_json() {
        let json = r#"{"headline":"Added login","description":"Implemented login flow","category":"feature","technical_details":"- auth.rs","tools_summary":"1 file"}"#;
        let resp = parse_response(json).unwrap();
        assert_eq!(resp.headline, "Added login");
        assert_eq!(resp.description, "Implemented login flow");
        assert_eq!(resp.category, "feature");
        assert_eq!(resp.technical_details, "- auth.rs");
        assert_eq!(resp.tools_summary, "1 file");
    }

    #[test]
    fn test_parse_response_with_surrounding_text() {
        let text = r#"Here is the changelog entry:
{"headline":"Fixed bug","description":"Fixed crash on login","category":"bugfix","technical_details":"","tools_summary":""}
Hope this helps!"#;
        let resp = parse_response(text).unwrap();
        assert_eq!(resp.headline, "Fixed bug");
        assert_eq!(resp.category, "bugfix");
    }

    #[test]
    fn test_parse_response_invalid_json_returns_error() {
        let text = "This is not JSON at all";
        let result = parse_response(text);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse"));
    }

    #[test]
    fn test_parse_response_partial_json_returns_error() {
        let text = r#"{"headline":"incomplete"#;
        let result = parse_response(text);
        assert!(result.is_err());
    }

    // ── validate_response (via parse_response) ───────────────────────────

    #[test]
    fn test_validate_category_accepts_valid_values() {
        let valid = ["feature", "bugfix", "refactor", "docs", "config", "test", "plan"];
        for cat in &valid {
            let json = format!(
                r#"{{"headline":"test","description":"test","category":"{}","technical_details":"","tools_summary":""}}"#,
                cat
            );
            let resp = parse_response(&json).unwrap();
            assert_eq!(resp.category, *cat, "Category '{}' should be accepted as-is", cat);
        }
    }

    #[test]
    fn test_validate_category_defaults_invalid_to_feature() {
        let json = r#"{"headline":"test","description":"test","category":"UNKNOWN","technical_details":"","tools_summary":""}"#;
        let resp = parse_response(json).unwrap();
        assert_eq!(resp.category, "feature");
    }

    #[test]
    fn test_validate_headline_truncation() {
        let long_headline = "H".repeat(120);
        let json = format!(
            r#"{{"headline":"{}","description":"test","category":"feature","technical_details":"","tools_summary":""}}"#,
            long_headline
        );
        let resp = parse_response(&json).unwrap();
        assert_eq!(resp.headline.len(), 80);
    }

    #[test]
    fn test_parse_response_defaults_optional_fields() {
        // technical_details and tools_summary have #[serde(default)]
        let json = r#"{"headline":"test","description":"test","category":"feature"}"#;
        let resp = parse_response(json).unwrap();
        assert_eq!(resp.technical_details, "");
        assert_eq!(resp.tools_summary, "");
    }

    #[test]
    fn test_parse_response_sets_zero_tokens() {
        let json = r#"{"headline":"test","description":"test","category":"feature","technical_details":"","tools_summary":""}"#;
        let resp = parse_response(json).unwrap();
        assert_eq!(resp.input_tokens, 0);
        assert_eq!(resp.output_tokens, 0);
    }

    // ── build_anthropic_body ─────────────────────────────────────────────

    // Regression: Anthropic deprecated `temperature` for Opus 4.8 (returns 400
    // "`temperature` is deprecated for this model"). The Settings → Test API Key
    // button picks the first AI_MODELS.anthropic entry (claude-opus-4-8), so any
    // hardcoded `temperature` makes the test always fail.
    #[test]
    fn test_anthropic_body_omits_temperature() {
        let body = build_anthropic_body("claude-opus-4-8", "system", "user prompt", "off");
        assert!(
            body.get("temperature").is_none(),
            "Anthropic request body must not include `temperature` — it's rejected by Opus 4.8+"
        );
    }

    #[test]
    fn test_anthropic_body_has_required_fields() {
        let body = build_anthropic_body("claude-sonnet-4-6", "sys", "hi", "off");
        assert_eq!(body["model"], "claude-sonnet-4-6");
        assert_eq!(body["max_tokens"], 1024);
        assert_eq!(body["system"], "sys");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "hi");
    }

    #[test]
    fn test_anthropic_thinking_off_omits_thinking_block() {
        let body = build_anthropic_body("claude-sonnet-4-6", "sys", "hi", "off");
        assert!(body.get("thinking").is_none(), "off must not enable extended thinking");
        assert_eq!(body["max_tokens"], 1024);
    }

    #[test]
    fn test_anthropic_thinking_high_enables_block_with_headroom() {
        let body = build_anthropic_body("claude-opus-4-8", "sys", "hi", "high");
        assert_eq!(body["thinking"]["type"], "enabled");
        let budget = body["thinking"]["budget_tokens"].as_u64().unwrap();
        let max = body["max_tokens"].as_u64().unwrap();
        assert!(budget > 0);
        assert!(max > budget, "max_tokens must exceed the thinking budget");
    }

    // ── build_gemini_body ────────────────────────────────────────────────

    #[test]
    fn test_gemini_thinking_off_sets_budget_zero() {
        // The eval finding: thinking-default models (3.5-flash) truncate the
        // JSON unless thinking is forced off. budget 0 is that lever.
        let body = build_gemini_body("gemini-3.5-flash", "sys", "hi", "off");
        assert_eq!(body["generationConfig"]["thinkingConfig"]["thinkingBudget"], 0);
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 1024);
    }

    #[test]
    fn test_gemini_thinking_high_raises_budget_and_output() {
        let body = build_gemini_body("gemini-3.5-flash", "sys", "hi", "high");
        let budget = body["generationConfig"]["thinkingConfig"]["thinkingBudget"].as_u64().unwrap();
        let max = body["generationConfig"]["maxOutputTokens"].as_u64().unwrap();
        assert!(budget > 0);
        assert!(max > 1024, "thinking-on raises the output budget so the answer still fits");
    }

    #[test]
    fn test_gemini_body_omits_temperature_change_and_keeps_json_mime() {
        let body = build_gemini_body("gemini-3.1-flash-lite", "sys", "hi", "off");
        assert_eq!(body["generationConfig"]["responseMimeType"], "application/json");
    }

    // ── build_openai_body ────────────────────────────────────────────────

    // Regression: GPT-5 family + reasoning models (o1/o3/o4) reject non-default
    // `temperature` with HTTP 400 ("Only the default (1) is supported").
    #[test]
    fn test_openai_body_omits_temperature() {
        let body = build_openai_body("gpt-5.4", "system", "user prompt", "off");
        assert!(
            body.get("temperature").is_none(),
            "OpenAI request body must not include `temperature` — rejected by GPT-5 family and reasoning models"
        );
    }

    #[test]
    fn test_openai_body_has_required_fields() {
        let body = build_openai_body("gpt-5.4-mini", "sys", "hi", "off");
        assert_eq!(body["model"], "gpt-5.4-mini");
        assert_eq!(body["max_completion_tokens"], 1024);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["role"], "user");
    }

    #[test]
    fn test_openai_thinking_off_is_minimal_effort() {
        let body = build_openai_body("gpt-5.4", "sys", "hi", "off");
        assert_eq!(body["reasoning_effort"], "minimal");
        assert_eq!(body["max_completion_tokens"], 1024);
    }

    #[test]
    fn test_openai_thinking_levels_map_to_effort_and_raise_budget() {
        let high = build_openai_body("gpt-5.4", "sys", "hi", "high");
        assert_eq!(high["reasoning_effort"], "high");
        assert!(high["max_completion_tokens"].as_u64().unwrap() > 1024);
        let med = build_openai_body("gpt-5.4", "sys", "hi", "medium");
        assert_eq!(med["reasoning_effort"], "medium");
    }

    // ── normalize_thinking ───────────────────────────────────────────────

    #[test]
    fn test_normalize_thinking() {
        assert_eq!(normalize_thinking("off"), "off");
        assert_eq!(normalize_thinking("OFF"), "off");
        assert_eq!(normalize_thinking(""), "off");
        assert_eq!(normalize_thinking("garbage"), "off");
        assert_eq!(normalize_thinking("Low"), "low");
        assert_eq!(normalize_thinking("medium"), "medium");
        assert_eq!(normalize_thinking("HIGH"), "high");
    }

    // ── build_openrouter_body ────────────────────────────────────────────

    // Regression: OpenRouter forwards to the underlying model. If routed to
    // Anthropic Opus 4.8 or OpenAI GPT-5, `temperature` is rejected with 400.
    #[test]
    fn test_openrouter_body_omits_temperature() {
        let body = build_openrouter_body("anthropic/claude-opus-4-8", "system", "user prompt");
        assert!(
            body.get("temperature").is_none(),
            "OpenRouter request body must not include `temperature` — underlying providers reject it"
        );
    }

    #[test]
    fn test_openrouter_body_has_required_fields() {
        let body = build_openrouter_body("openai/gpt-5", "sys", "hi");
        assert_eq!(body["model"], "openai/gpt-5");
        assert_eq!(body["max_completion_tokens"], 1024);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["role"], "user");
    }
}
