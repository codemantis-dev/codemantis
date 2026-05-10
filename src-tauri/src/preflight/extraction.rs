// Preflight extraction — given a saved spec and its parsed sessions, ask
// an LLM "what external services and tools does this project need?" and
// turn the answer into a `preflight.yaml` manifest.
//
// Triggered when the user finalises a SpecWriter spec (i.e. when the
// spec save creates an Implementation Guide). Uses the same AI provider/
// model the user selected for SpecWriter actions.

#![allow(dead_code)]

use crate::preflight::catalog::Catalog;
use crate::preflight::manifest::{
    Capability, Category, DetectionHints, Manifest, Storage, StorageKind, Verification,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Input from the frontend: which sessions exist and what the spec says.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionRequest {
    pub project_path: String,
    pub project_name: String,
    pub spec_content: String,
    pub sessions: Vec<SessionInput>,
    /// Provider id matching settings.api_keys (e.g. "anthropic", "openai",
    /// "gemini", "openrouter"). Caller pulls this from the SpecWriter
    /// conversation's `ai_provider` field.
    pub ai_provider: String,
    /// Model id for that provider (e.g. "claude-haiku-4-5").
    pub ai_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub index: u32,
    pub name: String,
    /// Free-form session content the LLM will read. Could be the session
    /// prompt + scope + read sections — whatever the caller has.
    pub body: String,
}

/// What a single LLM-detected capability looks like before we resolve it
/// against the bundled catalog. Permissive — the model returns a slug it
/// thinks is right; we then map it to a known catalog entry or drop it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedCapability {
    /// Suggested catalog_ref. Best-effort match against bundled entries.
    pub catalog_ref: String,
    /// Optional fallback name if catalog_ref doesn't resolve.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Indices of sessions that need this capability.
    #[serde(default)]
    pub session_indices: Vec<u32>,
    /// One-line "why this is needed" for Mission Control.
    #[serde(default)]
    pub purpose: Option<String>,
    /// LLM's confidence (0.0..1.0). We use it as a tiebreaker, not a gate.
    #[serde(default = "default_confidence")]
    pub confidence: f32,
    /// Whether it blocks Self-Drive. LLM defaults to true; user can toggle later.
    #[serde(default = "default_true")]
    pub required: bool,
}

fn default_confidence() -> f32 {
    0.8
}
fn default_true() -> bool {
    true
}

/// Result of running the full extract → resolve → audit pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionResult {
    /// The generated manifest, ready to serialise to preflight.yaml.
    pub manifest: Manifest,
    /// For each session index, the `requires:` IDs to add (so the frontend
    /// can update its guide store and persist).
    pub requires_by_session: HashMap<u32, Vec<String>>,
    /// Catalog refs the LLM proposed but we couldn't resolve. UI can show
    /// these to the user as "we noticed X but don't have a recipe yet".
    pub unresolved_refs: Vec<String>,
    /// LLM token usage (rolled up across the single extraction call).
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum ExtractionError {
    #[error("unknown AI provider: {0}")]
    UnknownProvider(String),
    #[error("API error: {0}")]
    Api(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("catalog error: {0}")]
    Catalog(String),
}

const SYSTEM_PROMPT: &str = r#"You analyse software project specs and identify what external services and developer tools the project will need at runtime.

Respond with ONLY a JSON object: {"capabilities": [...]}.

Each capability is:
{
  "catalog_ref": "<canonical id from the known list below, or your own slug>",
  "display_name": "<human-friendly name>",
  "session_indices": [<list of session.index values that touch this capability>],
  "purpose": "<one sentence: why is this needed?>",
  "confidence": <0.0..1.0>,
  "required": <true if Self-Drive cannot proceed without it; false for nice-to-have>
}

Prefer these known catalog refs when applicable:
- anthropic.api_key       (Anthropic / Claude API)
- openai.api_key          (OpenAI / GPT API)
- gemini.api_key          (Google Gemini)
- openrouter.api_key      (OpenRouter; alternative LLM gateway)
- supabase.anon_key       (Supabase project public key)
- stripe.api_key.secret   (Stripe server-side API key)
- stripe.webhook.signing_secret (Stripe webhook signing secret)
- resend.api_key          (Resend transactional email)
- google_oauth.client_id  (Google OAuth Client ID, for Sign-in-with-Google)
- system.node.20          (Node.js 20+)
- system.pnpm             (pnpm package manager)
- system.git              (git)
- system.docker           (Docker Desktop)

Rules:
- Only list capabilities the spec or sessions actually rely on. Don't speculate.
- If the spec mentions Stripe, list both stripe.api_key.secret and stripe.webhook.signing_secret only if webhooks are explicitly used.
- Match catalog_ref to the known list when you can. For services not in the list, invent a slug like "service.subcomponent" — these will be marked as needing setup but no automated verification.
- session_indices must reference real session.index values from the input."#;

fn build_user_prompt(request: &ExtractionRequest) -> String {
    let mut s = String::new();
    s.push_str("Project name: ");
    s.push_str(&request.project_name);
    s.push_str("\n\nSpec content (truncated to 8000 chars):\n---\n");
    let mut truncated = request.spec_content.clone();
    if truncated.len() > 8000 {
        truncated.truncate(8000);
        truncated.push_str("\n…[truncated]");
    }
    s.push_str(&truncated);
    s.push_str("\n---\n\nSessions:\n");
    for sess in &request.sessions {
        s.push_str(&format!("- index {}: {}\n", sess.index, sess.name));
        let mut body = sess.body.clone();
        if body.len() > 1500 {
            body.truncate(1500);
            body.push('…');
        }
        if !body.is_empty() {
            s.push_str("    ");
            // Indent each line for readability
            for (i, line) in body.lines().enumerate() {
                if i > 0 {
                    s.push_str("\n    ");
                }
                s.push_str(line);
            }
            s.push('\n');
        }
    }
    s.push_str("\nReturn JSON only.");
    s
}

#[derive(Debug, Deserialize)]
struct LlmResponse {
    #[serde(default)]
    capabilities: Vec<ExtractedCapability>,
}

/// Dispatch to the right provider's HTTP call (reusing summarizer's
/// pub(crate) functions so we don't duplicate the HTTP plumbing).
async fn call_llm(
    provider: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    prompt: &str,
) -> Result<(String, u32, u32), ExtractionError> {
    use crate::changelog::summarizer;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| ExtractionError::Api(e.to_string()))?;
    let result = match provider {
        "anthropic" => {
            summarizer::call_anthropic(&client, api_key, model, system_prompt, prompt).await
        }
        "openai" => {
            summarizer::call_openai(&client, api_key, model, system_prompt, prompt).await
        }
        "gemini" => {
            summarizer::call_gemini(&client, api_key, model, system_prompt, prompt).await
        }
        "openrouter" => {
            summarizer::call_openrouter(&client, api_key, model, system_prompt, prompt).await
        }
        other => return Err(ExtractionError::UnknownProvider(other.into())),
    };
    result.map_err(ExtractionError::Api)
}

/// Pluck the JSON object out of a chatty LLM response. Tolerates leading
/// prose, markdown fences, and trailing commentary.
fn isolate_json(text: &str) -> &str {
    let trimmed = text.trim();
    // Strip markdown code fences.
    let stripped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    let stripped = stripped.trim_start_matches('\n');
    let cleaned = stripped.strip_suffix("```").unwrap_or(stripped).trim();

    // Find the first '{' and last '}' to extract the JSON body.
    let start = cleaned.find('{');
    let end = cleaned.rfind('}');
    match (start, end) {
        (Some(s), Some(e)) if e >= s => &cleaned[s..=e],
        _ => cleaned,
    }
}

/// Run the LLM call; return the parsed list of extracted capabilities.
pub async fn extract(
    request: &ExtractionRequest,
    api_key: &str,
) -> Result<(Vec<ExtractedCapability>, u32, u32), ExtractionError> {
    let prompt = build_user_prompt(request);
    let (raw, in_tok, out_tok) = call_llm(
        &request.ai_provider,
        api_key,
        &request.ai_model,
        SYSTEM_PROMPT,
        &prompt,
    )
    .await?;
    let body = isolate_json(&raw);
    let parsed: LlmResponse = serde_json::from_str(body).map_err(|e| {
        ExtractionError::Parse(format!(
            "could not parse LLM JSON ({}): {}",
            e,
            body.chars().take(200).collect::<String>()
        ))
    })?;
    Ok((parsed.capabilities, in_tok, out_tok))
}

/// Resolve LLM-extracted capabilities against the bundled catalog and
/// build a Manifest plus per-session `requires:` lists.
///
/// Bundled-known refs become first-class capabilities. Unknown refs go
/// into `unresolved_refs` so the UI can surface them as "needs setup but
/// we don't have a recipe yet" — Phase 5.5/5+ may auto-generate via AI
/// fallback.
pub fn build_manifest(
    request: &ExtractionRequest,
    extracted: &[ExtractedCapability],
    catalog: &Catalog,
    generated_by: &str,
) -> ExtractionResult {
    let mut capabilities = Vec::new();
    let mut requires_by_session: HashMap<u32, Vec<String>> = HashMap::new();
    let mut unresolved: Vec<String> = Vec::new();

    let valid_indices: std::collections::HashSet<u32> =
        request.sessions.iter().map(|s| s.index).collect();

    for ext in extracted {
        let known = catalog.get(&ext.catalog_ref).is_some();
        if !known {
            unresolved.push(ext.catalog_ref.clone());
            continue;
        }
        let cap_id = format!("PREFLIGHT-{}", slug(&ext.catalog_ref));
        let cap = Capability {
            id: cap_id.clone(),
            catalog_ref: ext.catalog_ref.clone(),
            name: ext
                .display_name
                .clone()
                .unwrap_or_else(|| ext.catalog_ref.clone()),
            category: infer_category(&ext.catalog_ref),
            purpose: ext.purpose.clone(),
            sessions_requiring: ext
                .session_indices
                .iter()
                .filter(|i| valid_indices.contains(i))
                .map(|i| format!("SESS-{:03}", i))
                .collect(),
            storage: Some(Storage {
                kind: infer_storage_kind(&ext.catalog_ref),
                key: ext.catalog_ref.clone(),
            }),
            verification: Verification::SecretPresent {
                key: ext.catalog_ref.clone(),
            },
            value_validation: None,
            required: ext.required,
            blocks_self_drive: ext.required,
            detection_hints: DetectionHints::default(),
        };
        for idx in &ext.session_indices {
            if !valid_indices.contains(idx) {
                continue;
            }
            requires_by_session
                .entry(*idx)
                .or_default()
                .push(cap_id.clone());
        }
        capabilities.push(cap);
    }

    let manifest = Manifest {
        schema_version: "1.0".into(),
        project: request.project_name.clone(),
        generated_by: Some(generated_by.into()),
        generated_at: Some(chrono::Utc::now().to_rfc3339()),
        capabilities,
    };

    ExtractionResult {
        manifest,
        requires_by_session,
        unresolved_refs: unresolved,
        input_tokens: 0,
        output_tokens: 0,
    }
}

fn slug(catalog_ref: &str) -> String {
    catalog_ref
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '-'
            }
        })
        .collect()
}

/// Infer category from the catalog_ref slug shape. System tools auto-resolve;
/// services route through the human-guided flow.
fn infer_category(catalog_ref: &str) -> Category {
    if catalog_ref.starts_with("system.") {
        Category::AutoResolvable
    } else {
        Category::GuidedHuman
    }
}

fn infer_storage_kind(catalog_ref: &str) -> StorageKind {
    if catalog_ref.starts_with("system.") {
        StorageKind::EnvVar
    } else {
        StorageKind::SecretBox
    }
}

/// Render the manifest to YAML (the canonical preflight.yaml format).
pub fn manifest_to_yaml(manifest: &Manifest) -> Result<String, ExtractionError> {
    serde_yml::to_string(manifest).map_err(|e| ExtractionError::Catalog(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::catalog::Catalog;
    use std::path::Path;

    fn repo_catalog() -> Catalog {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let catalog_dir = Path::new(manifest_dir).parent().unwrap().join("catalog");
        Catalog::load_from_dir(&catalog_dir).unwrap()
    }

    fn req() -> ExtractionRequest {
        ExtractionRequest {
            project_path: "/p".into(),
            project_name: "Atikon".into(),
            spec_content: "Spec body".into(),
            sessions: vec![
                SessionInput { index: 1, name: "Foundation".into(), body: "set up node".into() },
                SessionInput { index: 2, name: "Auth".into(), body: "google login".into() },
                SessionInput { index: 3, name: "Billing".into(), body: "stripe subscriptions".into() },
            ],
            ai_provider: "anthropic".into(),
            ai_model: "claude-haiku-4-5".into(),
        }
    }

    #[test]
    fn isolate_json_extracts_object_from_chatty_response() {
        let raw = "Sure! Here you go:\n```json\n{\"capabilities\": []}\n```\nLet me know if you need more.";
        let body = isolate_json(raw);
        let parsed: LlmResponse = serde_json::from_str(body).unwrap();
        assert!(parsed.capabilities.is_empty());
    }

    #[test]
    fn isolate_json_handles_no_fences() {
        // ExtractedCapability is camelCase on the wire (matches the JSON the
        // LLM produces from our prompt), so we use catalogRef / sessionIndices.
        let raw = r#"{"capabilities": [{"catalogRef": "x", "sessionIndices": [1]}]}"#;
        let body = isolate_json(raw);
        let parsed: LlmResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.capabilities.len(), 1);
    }

    #[test]
    fn build_manifest_resolves_known_refs_and_drops_unknowns() {
        let extracted = vec![
            ExtractedCapability {
                catalog_ref: "stripe.api_key.secret".into(),
                display_name: None,
                session_indices: vec![3],
                purpose: Some("Charges".into()),
                confidence: 0.95,
                required: true,
            },
            ExtractedCapability {
                catalog_ref: "some.unknown.service".into(),
                display_name: Some("Unknown".into()),
                session_indices: vec![3],
                purpose: None,
                confidence: 0.7,
                required: true,
            },
        ];
        let cat = repo_catalog();
        let result = build_manifest(&req(), &extracted, &cat, "test");
        assert_eq!(result.manifest.capabilities.len(), 1);
        assert_eq!(
            result.manifest.capabilities[0].catalog_ref,
            "stripe.api_key.secret"
        );
        assert_eq!(result.unresolved_refs, vec!["some.unknown.service"]);
    }

    #[test]
    fn build_manifest_populates_requires_by_session() {
        let extracted = vec![ExtractedCapability {
            catalog_ref: "openai.api_key".into(),
            display_name: None,
            session_indices: vec![1, 2],
            purpose: None,
            confidence: 0.9,
            required: true,
        }];
        let cat = repo_catalog();
        let result = build_manifest(&req(), &extracted, &cat, "test");
        assert!(result.requires_by_session.contains_key(&1));
        assert!(result.requires_by_session.contains_key(&2));
        assert!(!result.requires_by_session.contains_key(&3));
    }

    #[test]
    fn build_manifest_drops_session_indices_outside_input() {
        // LLM hallucinates session 99; we silently filter it.
        let extracted = vec![ExtractedCapability {
            catalog_ref: "openai.api_key".into(),
            display_name: None,
            session_indices: vec![99],
            purpose: None,
            confidence: 0.9,
            required: true,
        }];
        let cat = repo_catalog();
        let result = build_manifest(&req(), &extracted, &cat, "test");
        assert!(result.requires_by_session.is_empty());
        // The capability is still added, just without session pinning.
        assert_eq!(result.manifest.capabilities.len(), 1);
    }

    #[test]
    fn system_refs_become_auto_resolvable_with_env_var_storage() {
        let extracted = vec![ExtractedCapability {
            catalog_ref: "system.node.20".into(),
            display_name: None,
            session_indices: vec![1],
            purpose: None,
            confidence: 1.0,
            required: true,
        }];
        let cat = repo_catalog();
        let result = build_manifest(&req(), &extracted, &cat, "test");
        let cap = &result.manifest.capabilities[0];
        assert_eq!(cap.category, Category::AutoResolvable);
        assert_eq!(
            cap.storage.as_ref().unwrap().kind,
            StorageKind::EnvVar
        );
    }

    #[test]
    fn services_become_guided_human_with_secret_box_storage() {
        let extracted = vec![ExtractedCapability {
            catalog_ref: "stripe.api_key.secret".into(),
            display_name: None,
            session_indices: vec![3],
            purpose: None,
            confidence: 0.9,
            required: true,
        }];
        let cat = repo_catalog();
        let result = build_manifest(&req(), &extracted, &cat, "test");
        let cap = &result.manifest.capabilities[0];
        assert_eq!(cap.category, Category::GuidedHuman);
        assert_eq!(
            cap.storage.as_ref().unwrap().kind,
            StorageKind::SecretBox
        );
    }

    #[test]
    fn manifest_round_trips_through_yaml() {
        let extracted = vec![ExtractedCapability {
            catalog_ref: "openai.api_key".into(),
            display_name: None,
            session_indices: vec![1],
            purpose: Some("AI summaries".into()),
            confidence: 0.9,
            required: true,
        }];
        let cat = repo_catalog();
        let result = build_manifest(&req(), &extracted, &cat, "test");
        let yaml = manifest_to_yaml(&result.manifest).unwrap();
        let parsed = Manifest::from_yaml(&yaml);
        assert!(parsed.is_ok());
        let restored = parsed.unwrap();
        assert_eq!(restored.capabilities.len(), 1);
        assert_eq!(restored.project, "Atikon");
    }

    #[test]
    fn build_user_prompt_truncates_long_spec_content() {
        let mut r = req();
        r.spec_content = "x".repeat(20_000);
        let prompt = build_user_prompt(&r);
        // Prompt is finite — truncated marker is present.
        assert!(prompt.contains("[truncated]"));
        assert!(prompt.len() < 12_000);
    }

    #[test]
    fn build_user_prompt_truncates_long_session_bodies() {
        let mut r = req();
        r.sessions[0].body = "y".repeat(5000);
        let prompt = build_user_prompt(&r);
        // Each session body is independently truncated.
        assert!(prompt.contains("…"));
    }

    #[test]
    fn slug_uppercases_and_dashes() {
        assert_eq!(slug("stripe.api_key.secret"), "STRIPE-API-KEY-SECRET");
        assert_eq!(slug("system.node.20"), "SYSTEM-NODE-20");
    }
}
