//! §10 step 3 — generate a starter `MANIFEST.md` via one harvester
//! LLM call.
//!
//! Inputs:
//! - the manifest-seed sections extracted from README + CLAUDE
//! - top N seed-landmine + seed-pattern titles from the vault
//! - the project's primary manifest (`package.json` / `Cargo.toml` /
//!   `pyproject.toml`) — used for stack identification
//!
//! Output: a ~20-line `MANIFEST.md` at the vault root with:
//! - stack identification (1 line)
//! - top conventions (3-5 lines, distilled from the seed sections)
//! - top landmines (≤5 lines, one per seeded landmine)
//!
//! The LLM call is OPTIONAL. When the harvester model is missing /
//! the api_key is empty, `generate` returns `Ok(SkippedReason::*)`
//! and the orchestrator falls back to a deterministic "shell"
//! MANIFEST (stack id + the raw seed sections + landmine list).

use std::path::Path;

use serde::Deserialize;

use crate::recall::config::RecallConfig;
use crate::recall::llm_client::{LlmClient, LlmRequest};
use crate::recall::vault::Vault;
use crate::recall::RecallError;

const SYSTEM_PROMPT: &str = r###"You are the Recall seed step. Distill the project context into a 20-line MANIFEST.md.

Rules:
- Line 1: one-sentence stack identification (language, framework, build tool).
- Then a "## Conventions" section: 3-5 bullet points distilled from the user's existing rules / conventions. Be concrete.
- Then a "## Landmines" section: ≤5 bullets, one per provided landmine title. Each bullet should be a 1-line summary, no longer.
- No prose paragraphs. No filler. No claims you cannot ground in the input.

Return ONLY the manifest markdown, no surrounding ``` fences."###;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ManifestInput {
    /// Sections extracted from README/CLAUDE via
    /// [`super::ingest_existing::extract_manifest_sections`].
    pub manifest_seed_sections: String,
    /// Identifier for the primary manifest file content
    /// (`package.json`, `Cargo.toml`, etc.) — used by the LLM to do
    /// stack identification. Empty when none was found.
    pub project_manifest_summary: String,
    /// Up to 5 seed-landmine titles. The LLM is asked to write one
    /// bullet per title.
    pub landmine_titles: Vec<String>,
}

impl ManifestInput {
    pub fn is_empty(&self) -> bool {
        self.manifest_seed_sections.is_empty()
            && self.project_manifest_summary.is_empty()
            && self.landmine_titles.is_empty()
    }
}

#[derive(Debug, Clone)]
pub enum GenerateOutcome {
    /// MANIFEST.md was written via the LLM. Carries the assembled
    /// body so the caller can show a preview.
    LlmWritten { body: String, tokens: u32, cost_usd: f64 },
    /// LLM was unavailable; a deterministic fallback was written
    /// instead.
    FallbackWritten { body: String, reason: String },
    /// Existing MANIFEST.md was found — left untouched per the
    /// "idempotent seeding" rule. No write performed.
    AlreadyExists,
    /// Empty input + no LLM = nothing to write.
    Skipped { reason: String },
}

/// Generate (and write) MANIFEST.md at `<vault>/MANIFEST.md`. When
/// an LLM call is feasible, use it; otherwise fall back to a
/// deterministic shell composed of the seed sections.
pub async fn generate(
    llm: Option<&dyn LlmClient>,
    api_key: &str,
    config: &RecallConfig,
    vault: &Vault,
    input: &ManifestInput,
) -> Result<GenerateOutcome, RecallError> {
    let manifest_path = vault.root().join("MANIFEST.md");
    if manifest_path.exists() {
        return Ok(GenerateOutcome::AlreadyExists);
    }
    if input.is_empty() {
        return Ok(GenerateOutcome::Skipped {
            reason: "no seed content available".to_string(),
        });
    }

    let user_payload = render_user_payload(input);

    // LLM path: only when we have a client AND an API key AND the
    // harvester provider/model are configured.
    if let Some(client) = llm {
        if !api_key.is_empty()
            && !config.harvester_provider.is_empty()
            && !config.harvester_model.is_empty()
        {
            let req = LlmRequest {
                provider: config.harvester_provider.clone(),
                model: config.harvester_model.clone(),
                system_prompt: SYSTEM_PROMPT.to_string(),
                user_prompt: user_payload.clone(),
                timeout: crate::recall::llm_client::DEFAULT_TIMEOUT,
            };
            match client.call(req, api_key).await {
                Ok(resp) => {
                    let body = strip_fence_wrapper(&resp.text);
                    write_manifest(vault, &body)?;
                    return Ok(GenerateOutcome::LlmWritten {
                        body,
                        tokens: resp.input_tokens.saturating_add(resp.output_tokens),
                        cost_usd: resp.cost_usd,
                    });
                }
                Err(e) => {
                    let reason = format!("LLM call failed ({}); using fallback", e);
                    log::warn!("[recall.manifest] {}", reason);
                    let body = fallback_body(input);
                    write_manifest(vault, &body)?;
                    return Ok(GenerateOutcome::FallbackWritten { body, reason });
                }
            }
        }
    }

    // No LLM available — deterministic fallback.
    let body = fallback_body(input);
    write_manifest(vault, &body)?;
    Ok(GenerateOutcome::FallbackWritten {
        body,
        reason: "no LLM client provided".to_string(),
    })
}

fn render_user_payload(input: &ManifestInput) -> String {
    let mut out = String::new();
    if !input.project_manifest_summary.is_empty() {
        out.push_str("## Project manifest file\n\n");
        out.push_str(&input.project_manifest_summary);
        out.push_str("\n\n");
    }
    if !input.manifest_seed_sections.is_empty() {
        out.push_str("## Existing rules / conventions / pitfalls\n\n");
        out.push_str(&input.manifest_seed_sections);
        out.push_str("\n\n");
    }
    if !input.landmine_titles.is_empty() {
        out.push_str("## Seeded landmines\n\n");
        for t in input.landmine_titles.iter().take(5) {
            out.push_str(&format!("- {}\n", t));
        }
    }
    out
}

fn fallback_body(input: &ManifestInput) -> String {
    let mut out = String::new();
    out.push_str("# Project manifest\n\n");
    out.push_str(
        "_Auto-seeded by Recall (LLM unavailable, deterministic fallback). \
         Edit by hand to refine; the Harvester will pick up edits on the \
         next reindex._\n\n",
    );
    if !input.project_manifest_summary.is_empty() {
        out.push_str("## Stack\n\n");
        out.push_str(&input.project_manifest_summary);
        out.push_str("\n\n");
    }
    if !input.manifest_seed_sections.is_empty() {
        out.push_str("## Conventions (from README / CLAUDE.md)\n\n");
        out.push_str(input.manifest_seed_sections.trim());
        out.push_str("\n\n");
    }
    if !input.landmine_titles.is_empty() {
        out.push_str("## Landmines\n\n");
        for t in input.landmine_titles.iter().take(5) {
            out.push_str(&format!("- {}\n", t));
        }
    }
    out
}

fn write_manifest(vault: &Vault, body: &str) -> Result<(), RecallError> {
    let path = vault.root().join("MANIFEST.md");
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, body.as_bytes())?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

fn strip_fence_wrapper(s: &str) -> String {
    let trimmed = s.trim();
    let opened = trimmed
        .strip_prefix("```markdown")
        .or_else(|| trimmed.strip_prefix("```md"))
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim();
    opened.strip_suffix("```").unwrap_or(opened).trim().to_string()
}

/// Convenience helper: scan the project root for a primary manifest
/// (Cargo.toml / package.json / pyproject.toml) and return a small
/// summary string for the LLM. Returns empty when nothing's found.
pub fn read_project_manifest_summary(project_root: &Path) -> String {
    let candidates = [
        ("Cargo.toml", "rust"),
        ("package.json", "node"),
        ("pyproject.toml", "python"),
        ("go.mod", "go"),
        ("Gemfile", "ruby"),
        ("composer.json", "php"),
    ];
    let mut out = String::new();
    for (name, lang) in &candidates {
        let path = project_root.join(name);
        if !path.is_file() {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        // Truncate to keep the LLM payload bounded.
        let truncated: String = raw.chars().take(2_000).collect();
        out.push_str(&format!(
            "--- {} (lang: {}) ---\n{}\n",
            name, lang, truncated
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::llm_client::MockLlmClient;
    use tempfile::TempDir;

    fn vault_in_tempdir() -> (TempDir, Vault) {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        (tmp, vault)
    }

    fn cfg() -> RecallConfig {
        RecallConfig {
            enabled: true,
            ..RecallConfig::default()
        }
    }

    #[tokio::test]
    async fn empty_input_and_no_llm_returns_skipped() {
        let (_tmp, vault) = vault_in_tempdir();
        let outcome = generate(None, "", &cfg(), &vault, &ManifestInput::default())
            .await
            .unwrap();
        assert!(matches!(outcome, GenerateOutcome::Skipped { .. }));
    }

    #[tokio::test]
    async fn existing_manifest_is_not_overwritten() {
        let (_tmp, vault) = vault_in_tempdir();
        std::fs::write(vault.root().join("MANIFEST.md"), "existing").unwrap();
        let input = ManifestInput {
            project_manifest_summary: "rust".into(),
            ..Default::default()
        };
        let outcome = generate(None, "", &cfg(), &vault, &input).await.unwrap();
        assert!(matches!(outcome, GenerateOutcome::AlreadyExists));
        let body = std::fs::read_to_string(vault.root().join("MANIFEST.md")).unwrap();
        assert_eq!(body, "existing");
    }

    #[tokio::test]
    async fn no_llm_uses_deterministic_fallback() {
        let (_tmp, vault) = vault_in_tempdir();
        let input = ManifestInput {
            project_manifest_summary: "Cargo.toml: codemantis".into(),
            manifest_seed_sections: "## Rules\n- be excellent".into(),
            landmine_titles: vec!["watch pgcrypto".into()],
        };
        let outcome = generate(None, "", &cfg(), &vault, &input).await.unwrap();
        match outcome {
            GenerateOutcome::FallbackWritten { body, .. } => {
                assert!(body.contains("be excellent"));
                assert!(body.contains("watch pgcrypto"));
                assert!(body.contains("Stack"));
            }
            other => panic!("expected FallbackWritten, got {:?}", other),
        }
        let on_disk = std::fs::read_to_string(vault.root().join("MANIFEST.md")).unwrap();
        assert!(on_disk.contains("be excellent"));
    }

    #[tokio::test]
    async fn llm_response_is_written_to_manifest_path() {
        let (_tmp, vault) = vault_in_tempdir();
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            "Rust + Tauri desktop app.\n\n## Conventions\n- snake_case Rust\n\n## Landmines\n- pgcrypto",
            120,
            40,
        );
        let input = ManifestInput {
            project_manifest_summary: "rust".into(),
            landmine_titles: vec!["pgcrypto".into()],
            ..Default::default()
        };
        let outcome = generate(Some(&llm), "k", &cfg(), &vault, &input).await.unwrap();
        match outcome {
            GenerateOutcome::LlmWritten { body, .. } => {
                assert!(body.contains("Rust + Tauri"));
                assert!(body.contains("## Conventions"));
            }
            other => panic!("expected LlmWritten, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn llm_failure_uses_fallback() {
        let (_tmp, vault) = vault_in_tempdir();
        let llm = MockLlmClient::new();
        llm.enqueue_err("provider down");
        let input = ManifestInput {
            project_manifest_summary: "node".into(),
            manifest_seed_sections: "## Rules\n- one".into(),
            ..Default::default()
        };
        let outcome = generate(Some(&llm), "k", &cfg(), &vault, &input).await.unwrap();
        match outcome {
            GenerateOutcome::FallbackWritten { body, reason } => {
                assert!(body.contains("- one"));
                assert!(reason.contains("LLM call failed"));
            }
            other => panic!("expected FallbackWritten, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn empty_api_key_falls_back_even_with_llm_present() {
        let (_tmp, vault) = vault_in_tempdir();
        let llm = MockLlmClient::new(); // no responses queued — would panic if called
        let input = ManifestInput {
            project_manifest_summary: "rust".into(),
            ..Default::default()
        };
        let outcome = generate(Some(&llm), "", &cfg(), &vault, &input).await.unwrap();
        assert!(matches!(outcome, GenerateOutcome::FallbackWritten { .. }));
        assert!(llm.calls().is_empty());
    }

    #[tokio::test]
    async fn fence_wrapped_llm_response_is_unwrapped() {
        let (_tmp, vault) = vault_in_tempdir();
        let llm = MockLlmClient::new();
        llm.enqueue_ok("```markdown\n# Real\n```", 10, 5);
        let input = ManifestInput {
            project_manifest_summary: "x".into(),
            ..Default::default()
        };
        let outcome = generate(Some(&llm), "k", &cfg(), &vault, &input).await.unwrap();
        if let GenerateOutcome::LlmWritten { body, .. } = outcome {
            assert!(!body.contains("```"));
            assert!(body.contains("# Real"));
        }
    }

    #[test]
    fn read_project_manifest_summary_finds_cargo_toml() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("Cargo.toml"), "[package]\nname = \"x\"").unwrap();
        let s = read_project_manifest_summary(tmp.path());
        assert!(s.contains("Cargo.toml"));
        assert!(s.contains("lang: rust"));
    }

    #[test]
    fn read_project_manifest_summary_returns_empty_when_none_found() {
        let tmp = TempDir::new().unwrap();
        let s = read_project_manifest_summary(tmp.path());
        assert!(s.is_empty());
    }

    #[test]
    fn manifest_input_is_empty_only_when_all_fields_empty() {
        assert!(ManifestInput::default().is_empty());
        let with_summary = ManifestInput {
            project_manifest_summary: "x".into(),
            ..Default::default()
        };
        assert!(!with_summary.is_empty());
    }
}
