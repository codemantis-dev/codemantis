// Preflight System — verifies external preconditions (API keys, accounts,
// CLI tools, OAuth setup) declared in a SpecWriter bundle's `preflight.yaml`
// before Self-Drive runs.
//
// Phase 0 ships only the data model and secret storage. Phase 2 adds the
// verification engine, Tauri commands, and event emitters. See
// `_guidance/requirements/CodeMantis_SPEC-Preflight-System-v1.md.md`.

pub mod manifest;
pub mod secrets;
