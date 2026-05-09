// Preflight System — verifies external preconditions (API keys, accounts,
// CLI tools, OAuth setup) declared in a SpecWriter bundle's `preflight.yaml`
// before Self-Drive runs.
//
// Phase 0 ships only the data model and secret storage. Phase 2 adds the
// verification engine, Tauri commands, and event emitters. See
// `_guidance/requirements/CodeMantis_SPEC-Preflight-System-v1.md.md`.

pub mod ai_fallback;
pub mod audit;
pub mod catalog;
pub mod catalog_cache;
pub mod commands;
pub mod detection;
pub mod detection_files;
pub mod events;
pub mod installer;
pub mod manifest;
pub mod secrets;
pub mod status;
pub mod verification;
