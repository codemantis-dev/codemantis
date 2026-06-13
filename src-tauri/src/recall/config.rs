//! Recall configuration.
//!
//! Phase 1 ships the full config surface so later phases can extend it
//! without breaking shape changes. Only `enabled` and a handful of vault
//! settings are consumed in Phase 1; Enricher/Harvester models, budgets,
//! and freshness thresholds become live in Phases 2–3.
//!
//! Phase 5 wires this into `AppSettings` proper (a `recall:` nested
//! object) and exposes the Settings UI.

use serde::{Deserialize, Serialize};

// Spec §4.1 default mode is `Suggested`. Phase 1 still ships behind a
// master `enabled` flag (default off) so Recall is dormant unless the
// user explicitly turns it on, regardless of the mode value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecallMode {
    /// Off: no Recall activity for this project.
    Off,
    /// Suggested (default): runs both Enricher and Harvester but failures
    /// are non-blocking warnings.
    #[default]
    Suggested,
    /// Enforced: Enricher must complete before the prompt sends;
    /// Harvester blocks commit-completion-event on failure.
    Enforced,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoggingLevel {
    Silent,
    #[default]
    Summary,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoHarvestTrigger {
    OnCommit,
    OnSessionEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoEnrichSource {
    AgentPrompts,
    ManualChat,
}

/// Full Recall configuration, per spec §4.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallConfig {
    /// Master flag. When false, all Recall activity is dormant — neither
    /// enricher nor harvester runs, and the index is not maintained.
    #[serde(default)]
    pub enabled: bool,

    #[serde(default)]
    pub mode: RecallMode,

    // --- Enricher LLM ---
    #[serde(default = "default_enricher_provider")]
    pub enricher_provider: String,
    #[serde(default = "default_enricher_model")]
    pub enricher_model: String,
    #[serde(default = "default_enricher_thinking")]
    pub enricher_thinking: String,

    // --- Harvester LLM ---
    #[serde(default = "default_harvester_provider")]
    pub harvester_provider: String,
    #[serde(default = "default_harvester_model")]
    pub harvester_model: String,
    #[serde(default = "default_harvester_thinking")]
    pub harvester_thinking: String,

    /// Cross-project meta-vault location. Empty = disabled.
    #[serde(default)]
    pub meta_vault_path: Option<String>,
    #[serde(default = "default_true")]
    pub cross_project_linking: bool,

    #[serde(default = "default_auto_harvest_triggers")]
    pub auto_harvest_triggers: Vec<AutoHarvestTrigger>,

    #[serde(default = "default_auto_enrich_sources")]
    pub auto_enrich_sources: Vec<AutoEnrichSource>,

    #[serde(default)]
    pub logging_level: LoggingLevel,

    #[serde(default = "default_token_budget_per_brief")]
    pub token_budget_per_brief: u32,

    #[serde(default = "default_stale_threshold_days")]
    pub stale_threshold_days: u32,

    #[serde(default = "default_true")]
    pub show_recall_panel: bool,

    /// Commit `.recall/` to git? Default off — vault is local-only.
    #[serde(default)]
    pub commit_vault_to_git: bool,
}

impl Default for RecallConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: RecallMode::default(),
            enricher_provider: default_enricher_provider(),
            enricher_model: default_enricher_model(),
            enricher_thinking: default_enricher_thinking(),
            harvester_provider: default_harvester_provider(),
            harvester_model: default_harvester_model(),
            harvester_thinking: default_harvester_thinking(),
            meta_vault_path: None,
            cross_project_linking: true,
            auto_harvest_triggers: default_auto_harvest_triggers(),
            auto_enrich_sources: default_auto_enrich_sources(),
            logging_level: LoggingLevel::default(),
            token_budget_per_brief: default_token_budget_per_brief(),
            stale_threshold_days: default_stale_threshold_days(),
            show_recall_panel: true,
            commit_vault_to_git: false,
        }
    }
}

fn default_true() -> bool {
    true
}

/// Canonicalise a Recall provider id for API-key lookup.
///
/// Recall historically defaults its provider to `"google"` (spec §4.1), but
/// the `AppSettings.api_keys` map — and the rest of CodeMantis (Changelog,
/// AI Providers) — keys Gemini credentials under `"gemini"`. Looking a key up
/// by the raw `"google"` string therefore misses, leaving the enricher and
/// harvester with an empty key (silent LLM failure → gather-only fallback).
///
/// This maps the legacy alias to the canonical id used by the key map. The
/// HTTP dispatch in `llm_client` already accepts both spellings, so only the
/// key lookup needs canonicalising — stored config values are left untouched
/// to avoid a settings migration.
pub fn canonical_provider(provider: &str) -> &str {
    match provider {
        "google" => "gemini",
        other => other,
    }
}

impl RecallConfig {
    /// The api-key map key for the enricher provider (see [`canonical_provider`]).
    pub fn enricher_key_id(&self) -> &str {
        canonical_provider(&self.enricher_provider)
    }

    /// The api-key map key for the harvester provider (see [`canonical_provider`]).
    pub fn harvester_key_id(&self) -> &str {
        canonical_provider(&self.harvester_provider)
    }
}

fn default_enricher_provider() -> String {
    "google".to_string()
}

fn default_enricher_model() -> String {
    // Spec §4.1 default. Phase 5 surfaces this as a dropdown populated
    // from the existing provider plumbing; users can override.
    "gemini-3.1-flash-lite".to_string()
}

fn default_enricher_thinking() -> String {
    "off".to_string()
}

fn default_harvester_provider() -> String {
    "google".to_string()
}

fn default_harvester_model() -> String {
    "gemini-3.1-flash-lite".to_string()
}

fn default_harvester_thinking() -> String {
    "off".to_string()
}

fn default_auto_harvest_triggers() -> Vec<AutoHarvestTrigger> {
    vec![AutoHarvestTrigger::OnCommit, AutoHarvestTrigger::OnSessionEnd]
}

fn default_auto_enrich_sources() -> Vec<AutoEnrichSource> {
    vec![AutoEnrichSource::AgentPrompts]
}

fn default_token_budget_per_brief() -> u32 {
    2000
}

fn default_stale_threshold_days() -> u32 {
    30
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_spec_section_4_1() {
        let cfg = RecallConfig::default();
        assert!(!cfg.enabled, "master flag defaults off");
        assert_eq!(cfg.mode, RecallMode::Suggested);
        assert_eq!(cfg.enricher_provider, "google");
        assert_eq!(cfg.enricher_model, "gemini-3.1-flash-lite");
        assert_eq!(cfg.enricher_thinking, "off");
        assert!(cfg.cross_project_linking);
        assert_eq!(cfg.auto_harvest_triggers.len(), 2);
        assert_eq!(cfg.auto_enrich_sources, vec![AutoEnrichSource::AgentPrompts]);
        assert_eq!(cfg.logging_level, LoggingLevel::Summary);
        assert_eq!(cfg.token_budget_per_brief, 2000);
        assert_eq!(cfg.stale_threshold_days, 30);
        assert!(cfg.show_recall_panel);
        assert!(!cfg.commit_vault_to_git);
    }

    #[test]
    fn round_trips_through_json() {
        let original = RecallConfig::default();
        let json = serde_json::to_string(&original).unwrap();
        let parsed: RecallConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.enricher_model, original.enricher_model);
        assert_eq!(parsed.mode, original.mode);
        assert_eq!(parsed.token_budget_per_brief, original.token_budget_per_brief);
    }

    #[test]
    fn missing_fields_in_json_use_defaults() {
        // Simulate a settings file written by an older version of
        // CodeMantis (or an over-eager hand edit). Every field should
        // come back populated.
        let partial = r#"{ "enabled": true }"#;
        let cfg: RecallConfig = serde_json::from_str(partial).unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.enricher_model, "gemini-3.1-flash-lite");
        assert_eq!(cfg.token_budget_per_brief, 2000);
    }

    #[test]
    fn canonical_provider_maps_google_to_gemini() {
        // The api-key map keys Gemini under "gemini"; Recall defaults to
        // "google". The alias must resolve so the key lookup hits.
        assert_eq!(canonical_provider("google"), "gemini");
        assert_eq!(canonical_provider("gemini"), "gemini");
        assert_eq!(canonical_provider("openai"), "openai");
        assert_eq!(canonical_provider("anthropic"), "anthropic");
    }

    #[test]
    fn default_config_key_ids_resolve_to_gemini() {
        let cfg = RecallConfig::default();
        // Defaults store "google" but must look up the "gemini" key.
        assert_eq!(cfg.enricher_provider, "google");
        assert_eq!(cfg.enricher_key_id(), "gemini");
        assert_eq!(cfg.harvester_key_id(), "gemini");
    }

    #[test]
    fn override_through_json_is_respected() {
        let json = r#"{
            "enabled": true,
            "mode": "enforced",
            "enricherModel": "custom-model",
            "tokenBudgetPerBrief": 4000
        }"#;
        let cfg: RecallConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.mode, RecallMode::Enforced);
        assert_eq!(cfg.enricher_model, "custom-model");
        assert_eq!(cfg.token_budget_per_brief, 4000);
    }
}
