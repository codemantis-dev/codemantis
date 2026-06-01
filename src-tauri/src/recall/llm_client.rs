//! Recall LLM client — thin wrapper over `changelog::summarizer`.
//!
//! Recall makes two LLM calls per cycle: the Enricher's smart-select
//! (Phase 2) and the Harvester's classify+generate (Phase 3). Both go
//! through the same trait so production code and tests have a single
//! seam — `RealLlmClient` dispatches to the existing per-provider
//! `call_*` helpers in `changelog::summarizer`, and `MockLlmClient`
//! returns canned responses for unit tests.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;

use crate::changelog::summarizer;
use crate::commands::settings::ModelPricing;
use crate::recall::RecallError;

/// Default per-call timeout. Spec §11.1: Enforced mode blocks the prompt
/// until either the call completes or the timeout fires; Suggested mode
/// falls through to gather-only.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct LlmRequest {
    pub provider: String,
    pub model: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub timeout: Duration,
}

#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub model: String,
    pub provider: String,
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    /// Issue one LLM call. The implementation must respect `req.timeout`
    /// and map any provider-side error into `RecallError` so the
    /// Enricher's per-mode fallback logic has a single thing to match.
    async fn call(&self, req: LlmRequest, api_key: &str) -> Result<LlmResponse, RecallError>;
}

/// Production client: dispatches to `changelog::summarizer::call_*`.
pub struct RealLlmClient {
    pricing: Vec<(String, ModelPricing)>,
}

impl RealLlmClient {
    pub fn new(pricing: std::collections::HashMap<String, ModelPricing>) -> Self {
        // Pre-flatten for cheap lookup; the changelog summarizer hands
        // us the same shape via `AppSettings.model_pricing`.
        Self {
            pricing: pricing.into_iter().collect(),
        }
    }

    fn cost(&self, model: &str, input_tokens: u32, output_tokens: u32) -> f64 {
        let pricing = self
            .pricing
            .iter()
            .find(|(name, _)| name == model)
            .map(|(_, p)| p);
        let Some(p) = pricing else {
            return 0.0;
        };
        (input_tokens as f64 / 1_000_000.0) * p.input
            + (output_tokens as f64 / 1_000_000.0) * p.output
    }
}

#[async_trait]
impl LlmClient for RealLlmClient {
    async fn call(&self, req: LlmRequest, api_key: &str) -> Result<LlmResponse, RecallError> {
        if api_key.is_empty() {
            return Err(RecallError::Config(format!(
                "no API key configured for provider {}",
                req.provider
            )));
        }
        // The summarizer's call_* functions use `reqwest` internally and
        // already implement their own connection timeout via reqwest's
        // default. We layer a `tokio::time::timeout` over the whole
        // future so we have a hard upper bound that respects
        // `req.timeout`.
        let client = reqwest::Client::builder()
            .timeout(req.timeout)
            .build()
            .map_err(|e| RecallError::Config(format!("reqwest builder: {}", e)))?;
        let dispatch = async {
            match req.provider.as_str() {
                "google" | "gemini" => {
                    summarizer::call_gemini(
                        &client,
                        api_key,
                        &req.model,
                        &req.system_prompt,
                        &req.user_prompt,
                    )
                    .await
                }
                "openai" => {
                    summarizer::call_openai(
                        &client,
                        api_key,
                        &req.model,
                        &req.system_prompt,
                        &req.user_prompt,
                    )
                    .await
                }
                "anthropic" => {
                    summarizer::call_anthropic(
                        &client,
                        api_key,
                        &req.model,
                        &req.system_prompt,
                        &req.user_prompt,
                    )
                    .await
                }
                other => Err(format!("unknown provider: {}", other)),
            }
        };
        let result = tokio::time::timeout(req.timeout, dispatch)
            .await
            .map_err(|_| RecallError::Config(format!("llm call timed out after {:?}", req.timeout)))?
            .map_err(RecallError::Config)?;
        let (text, input_tokens, output_tokens) = result;
        let cost_usd = self.cost(&req.model, input_tokens, output_tokens);
        Ok(LlmResponse {
            text,
            input_tokens,
            output_tokens,
            cost_usd,
            model: req.model,
            provider: req.provider,
        })
    }
}

/// In-memory mock client for tests. Pops responses (or errors) off a
/// FIFO queue; panics if queried beyond what was queued so tests catch
/// "called more than expected" outright.
pub struct MockLlmClient {
    queue: Mutex<VecDeque<Result<LlmResponse, RecallError>>>,
    calls: Mutex<Vec<LlmRequest>>,
}

impl Default for MockLlmClient {
    fn default() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl MockLlmClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue_ok(&self, text: impl Into<String>, input_tokens: u32, output_tokens: u32) {
        self.queue.lock().unwrap().push_back(Ok(LlmResponse {
            text: text.into(),
            input_tokens,
            output_tokens,
            cost_usd: 0.0,
            model: "mock".to_string(),
            provider: "mock".to_string(),
        }));
    }

    pub fn enqueue_err(&self, message: impl Into<String>) {
        self.queue
            .lock()
            .unwrap()
            .push_back(Err(RecallError::Config(message.into())));
    }

    pub fn calls(&self) -> Vec<LlmRequest> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl LlmClient for MockLlmClient {
    async fn call(&self, req: LlmRequest, _api_key: &str) -> Result<LlmResponse, RecallError> {
        self.calls.lock().unwrap().push(req.clone());
        let next = self
            .queue
            .lock()
            .unwrap()
            .pop_front()
            .expect("MockLlmClient called more times than enqueued");
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn real_client_cost_uses_pricing_map() {
        let mut pricing = HashMap::new();
        pricing.insert(
            "gemini-3.1-flash-lite".to_string(),
            ModelPricing { input: 0.25, output: 1.50 },
        );
        let client = RealLlmClient::new(pricing);
        // 1000 input tokens at $0.25/M = $0.00025
        // 500 output tokens at $1.50/M = $0.00075
        // total $0.001
        let cost = client.cost("gemini-3.1-flash-lite", 1000, 500);
        assert!((cost - 0.001).abs() < 1e-9, "expected ~0.001, got {}", cost);
    }

    #[test]
    fn real_client_returns_zero_cost_for_unknown_model() {
        let client = RealLlmClient::new(HashMap::new());
        assert_eq!(client.cost("nonexistent", 1000, 1000), 0.0);
    }

    #[tokio::test]
    async fn mock_client_records_calls_and_returns_queued_responses() {
        let mock = MockLlmClient::new();
        mock.enqueue_ok("hello", 10, 5);
        mock.enqueue_err("blowup");

        let req = LlmRequest {
            provider: "mock".into(),
            model: "m".into(),
            system_prompt: "sys".into(),
            user_prompt: "user".into(),
            timeout: Duration::from_secs(1),
        };
        let r1 = mock.call(req.clone(), "k").await.unwrap();
        assert_eq!(r1.text, "hello");
        assert_eq!(r1.input_tokens, 10);

        let r2 = mock.call(req.clone(), "k").await;
        assert!(r2.is_err());

        let calls = mock.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].user_prompt, "user");
    }

    #[tokio::test]
    #[should_panic(expected = "called more times than enqueued")]
    async fn mock_client_panics_on_unexpected_extra_call() {
        let mock = MockLlmClient::new();
        let req = LlmRequest {
            provider: "mock".into(),
            model: "m".into(),
            system_prompt: "".into(),
            user_prompt: "".into(),
            timeout: Duration::from_secs(1),
        };
        let _ = mock.call(req, "k").await;
    }

    #[tokio::test]
    async fn real_client_rejects_unknown_provider() {
        let client = RealLlmClient::new(HashMap::new());
        let req = LlmRequest {
            provider: "made-up".into(),
            model: "m".into(),
            system_prompt: "".into(),
            user_prompt: "".into(),
            timeout: Duration::from_millis(100),
        };
        let result = client.call(req, "k").await;
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("made-up") || msg.contains("unknown provider"));
    }

    #[tokio::test]
    async fn real_client_rejects_empty_api_key() {
        let client = RealLlmClient::new(HashMap::new());
        let req = LlmRequest {
            provider: "google".into(),
            model: "gemini-3.1-flash-lite".into(),
            system_prompt: "".into(),
            user_prompt: "".into(),
            timeout: Duration::from_millis(100),
        };
        let result = client.call(req, "").await;
        assert!(result.is_err());
    }
}
