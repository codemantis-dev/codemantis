use crate::claude::session::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_SECS: u64 = 900; // 15 minutes

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterModelResult {
    pub id: String,
    pub name: String,
    pub is_free: bool,
    pub input_modalities: Vec<String>,
    pub output_modalities: Vec<String>,
    pub context_length: u64,
    pub pricing_input: f64,
    pub pricing_output: f64,
}

#[derive(Debug, Deserialize)]
struct ApiModelsResponse {
    data: Vec<ApiModel>,
}

#[derive(Debug, Deserialize)]
struct ApiModel {
    id: String,
    name: String,
    #[serde(default)]
    pricing: Option<ApiPricing>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    architecture: Option<ApiArchitecture>,
}

#[derive(Debug, Deserialize)]
struct ApiPricing {
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    completion: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiArchitecture {
    #[serde(default)]
    input_modalities: Option<Vec<String>>,
    #[serde(default)]
    output_modalities: Option<Vec<String>>,
}

fn parse_pricing_to_per_million(price_str: &str) -> f64 {
    // OpenRouter pricing is per-token as a string (e.g. "0.00000025")
    // Convert to per-1M-tokens to match our internal format.
    // Some meta-models (Auto Router, Body Builder) return "-1" — clamp to 0.
    let per_token: f64 = price_str.parse().unwrap_or(0.0);
    if per_token < 0.0 {
        return 0.0;
    }
    per_token * 1_000_000.0
}

fn parse_model(m: ApiModel) -> OpenRouterModelResult {
    let pricing = m.pricing.as_ref();
    let prompt_str = pricing.and_then(|p| p.prompt.as_deref()).unwrap_or("0");
    let completion_str = pricing.and_then(|p| p.completion.as_deref()).unwrap_or("0");

    let is_free = parse_pricing_to_per_million(prompt_str) == 0.0
        && parse_pricing_to_per_million(completion_str) == 0.0;

    let arch = m.architecture.as_ref();
    let input_modalities = arch
        .and_then(|a| a.input_modalities.clone())
        .unwrap_or_else(|| vec!["text".to_string()]);
    let output_modalities = arch
        .and_then(|a| a.output_modalities.clone())
        .unwrap_or_else(|| vec!["text".to_string()]);

    OpenRouterModelResult {
        id: m.id,
        name: m.name,
        is_free,
        input_modalities,
        output_modalities,
        context_length: m.context_length.unwrap_or(4096),
        pricing_input: parse_pricing_to_per_million(prompt_str),
        pricing_output: parse_pricing_to_per_million(completion_str),
    }
}

#[tauri::command]
pub async fn fetch_openrouter_models(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<Vec<OpenRouterModelResult>, String> {
    // Check cache first
    {
        let cache = state.openrouter_model_cache.lock().await;
        if let Some((timestamp, models)) = cache.as_ref() {
            if timestamp.elapsed().as_secs() < CACHE_TTL_SECS {
                return Ok(models.clone());
            }
        }
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(OPENROUTER_MODELS_URL)
        .bearer_auth(&api_key)
        .header("HTTP-Referer", "https://codemantis.dev")
        .header("X-Title", "CodeMantis")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch OpenRouter models: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenRouter API error {}: {}", status, text));
    }

    let api_response: ApiModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenRouter models: {}", e))?;

    let models: Vec<OpenRouterModelResult> = api_response
        .data
        .into_iter()
        .map(parse_model)
        .collect();

    log::info!(
        "[openrouter] Fetched {} models ({} free)",
        models.len(),
        models.iter().filter(|m| m.is_free).count()
    );

    // Update cache
    {
        let mut cache = state.openrouter_model_cache.lock().await;
        *cache = Some((std::time::Instant::now(), models.clone()));
    }

    Ok(models)
}

#[tauri::command]
pub async fn test_openrouter_key(api_key: String) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(OPENROUTER_MODELS_URL)
        .bearer_auth(&api_key)
        .header("HTTP-Referer", "https://codemantis.dev")
        .header("X-Title", "CodeMantis")
        .send()
        .await
        .map_err(|e| format!("OpenRouter request failed: {}", e))?;

    Ok(resp.status().is_success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pricing_zero_is_free() {
        assert_eq!(parse_pricing_to_per_million("0"), 0.0);
    }

    #[test]
    fn parse_pricing_typical_value() {
        let result = parse_pricing_to_per_million("0.0000025");
        assert!((result - 2.5).abs() < 0.001);
    }

    #[test]
    fn parse_pricing_invalid_string() {
        assert_eq!(parse_pricing_to_per_million("invalid"), 0.0);
    }

    #[test]
    fn parse_pricing_negative_one_clamps_to_zero() {
        // OpenRouter returns "-1" for meta-models like Auto Router
        assert_eq!(parse_pricing_to_per_million("-1"), 0.0);
    }

    #[test]
    fn parse_pricing_negative_small_clamps_to_zero() {
        assert_eq!(parse_pricing_to_per_million("-0.000001"), 0.0);
    }

    #[test]
    fn parse_model_negative_pricing_treated_as_free() {
        let model = ApiModel {
            id: "openrouter/auto".to_string(),
            name: "Auto Router".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("-1".to_string()),
                completion: Some("-1".to_string()),
            }),
            context_length: Some(200000),
            architecture: None,
        };
        let result = parse_model(model);
        assert!(result.is_free);
        assert_eq!(result.pricing_input, 0.0);
        assert_eq!(result.pricing_output, 0.0);
    }

    #[test]
    fn parse_model_free_model() {
        let model = ApiModel {
            id: "test/model:free".to_string(),
            name: "Test Model".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("0".to_string()),
                completion: Some("0".to_string()),
            }),
            context_length: Some(128000),
            architecture: Some(ApiArchitecture {
                input_modalities: Some(vec!["text".to_string(), "image".to_string()]),
                output_modalities: Some(vec!["text".to_string()]),
            }),
        };
        let result = parse_model(model);
        assert!(result.is_free);
        assert_eq!(result.context_length, 128000);
        assert_eq!(result.input_modalities, vec!["text", "image"]);
        assert_eq!(result.pricing_input, 0.0);
    }

    #[test]
    fn parse_model_paid_model() {
        let model = ApiModel {
            id: "openai/gpt-4".to_string(),
            name: "GPT-4".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("0.00003".to_string()),
                completion: Some("0.00006".to_string()),
            }),
            context_length: Some(8192),
            architecture: Some(ApiArchitecture {
                input_modalities: Some(vec!["text".to_string(), "image".to_string(), "file".to_string()]),
                output_modalities: Some(vec!["text".to_string()]),
            }),
        };
        let result = parse_model(model);
        assert!(!result.is_free);
        assert!((result.pricing_input - 30.0).abs() < 0.001);
        assert!((result.pricing_output - 60.0).abs() < 0.001);
    }

    #[test]
    fn parse_model_missing_architecture_defaults_to_text() {
        let model = ApiModel {
            id: "test/model".to_string(),
            name: "Test".to_string(),
            pricing: None,
            context_length: None,
            architecture: None,
        };
        let result = parse_model(model);
        assert_eq!(result.input_modalities, vec!["text"]);
        assert_eq!(result.output_modalities, vec!["text"]);
        assert_eq!(result.context_length, 4096);
        assert!(result.is_free);
    }

    #[test]
    fn parse_pricing_empty_string() {
        assert_eq!(parse_pricing_to_per_million(""), 0.0);
    }

    #[test]
    fn parse_pricing_very_small_value() {
        // e.g. $0.15 per 1M tokens = $0.00000015 per token
        let result = parse_pricing_to_per_million("0.00000015");
        assert!((result - 0.15).abs() < 0.0001);
    }

    #[test]
    fn parse_model_preserves_id_with_slashes_and_colons() {
        let model = ApiModel {
            id: "meta-llama/llama-3.3-70b-instruct:free".to_string(),
            name: "Llama 3.3 70B".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("0".to_string()),
                completion: Some("0".to_string()),
            }),
            context_length: Some(131072),
            architecture: None,
        };
        let result = parse_model(model);
        assert_eq!(result.id, "meta-llama/llama-3.3-70b-instruct:free");
        assert_eq!(result.name, "Llama 3.3 70B");
        assert!(result.is_free);
        assert_eq!(result.context_length, 131072);
    }

    #[test]
    fn parse_model_partial_pricing_prompt_only() {
        let model = ApiModel {
            id: "test/partial".to_string(),
            name: "Partial".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("0.00001".to_string()),
                completion: None,
            }),
            context_length: Some(4096),
            architecture: None,
        };
        let result = parse_model(model);
        assert!(!result.is_free); // prompt is not "0"
        assert!((result.pricing_input - 10.0).abs() < 0.001);
        assert_eq!(result.pricing_output, 0.0); // completion defaults to "0"
    }

    #[test]
    fn parse_model_empty_modalities_array() {
        let model = ApiModel {
            id: "test/empty".to_string(),
            name: "Empty".to_string(),
            pricing: None,
            context_length: None,
            architecture: Some(ApiArchitecture {
                input_modalities: Some(vec![]),
                output_modalities: Some(vec![]),
            }),
        };
        let result = parse_model(model);
        assert!(result.input_modalities.is_empty());
        assert!(result.output_modalities.is_empty());
    }

    #[test]
    fn parse_model_mixed_negative_zero_pricing_is_free() {
        // prompt = "-1", completion = "0" → both clamp to 0 → is_free = true
        let model = ApiModel {
            id: "test/mixed".to_string(),
            name: "Mixed".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("-1".to_string()),
                completion: Some("0".to_string()),
            }),
            context_length: None,
            architecture: None,
        };
        let result = parse_model(model);
        assert!(result.is_free);
        assert_eq!(result.pricing_input, 0.0);
        assert_eq!(result.pricing_output, 0.0);
    }

    #[test]
    fn parse_model_zero_prompt_paid_completion_is_not_free() {
        // prompt = "0", completion = "0.00001" → not free
        let model = ApiModel {
            id: "test/half-paid".to_string(),
            name: "Half Paid".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("0".to_string()),
                completion: Some("0.00001".to_string()),
            }),
            context_length: None,
            architecture: None,
        };
        let result = parse_model(model);
        assert!(!result.is_free);
        assert_eq!(result.pricing_input, 0.0);
        assert!((result.pricing_output - 10.0).abs() < 0.001);
    }

    #[test]
    fn parse_model_serialization_roundtrip() {
        let model = ApiModel {
            id: "test/roundtrip".to_string(),
            name: "Roundtrip".to_string(),
            pricing: Some(ApiPricing {
                prompt: Some("0.000001".to_string()),
                completion: Some("0.000002".to_string()),
            }),
            context_length: Some(32768),
            architecture: Some(ApiArchitecture {
                input_modalities: Some(vec!["text".to_string(), "image".to_string()]),
                output_modalities: Some(vec!["text".to_string()]),
            }),
        };
        let result = parse_model(model);
        let json = serde_json::to_string(&result).unwrap();
        let restored: OpenRouterModelResult = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "test/roundtrip");
        assert_eq!(restored.context_length, 32768);
        assert_eq!(restored.input_modalities, vec!["text", "image"]);
    }
}
