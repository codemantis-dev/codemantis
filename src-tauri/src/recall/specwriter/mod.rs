//! SpecWriter integration for Recall (RECALL-SPEC §9.2).
//!
//! Four integration points wired in `commands/specwriter.rs`:
//!
//! 1. `gather_spec_context` → [`context_section::assemble`] appends a
//!    "Recall Context" section to the structural context blob.
//! 2. `save_spec_document` → [`spec_to_note::harvest`] turns the spec
//!    markdown into a `decision` note linked to overlapping landmines.
//! 3. `verify_action_parity` → [`parity_to_landmine::landmine_from_fail`]
//!    creates a `landmine` note from every stub-marker FAIL.
//! 4. `recover_session_plan` → [`recovery_landmines::collect_for_paths`]
//!    surfaces landmines for paths the Session Plan touches.
//!
//! §9.2.5 (Self-Drive Enricher) is already covered by Phase 2's
//! `send_message` enrichment — every Self-Drive prompt to the agent
//! flows through it. The Phase 4 integration test verifies this end
//! to end.
//!
//! §9.2.2 second bullet (spec-generation LLM call Enricher-wrapped) is
//! deferred to a Phase 4.5 follow-up: the spec-generation prompt goes
//! through `commands::assistant_chat::send_assistant_chat`, a
//! general-purpose multi-provider streaming command whose signature
//! would need surgery to add project_path + a SpecWriter-vs-other
//! discriminator. The structural Recall Context section from
//! `gather_spec_context` covers most of the value in the meantime.

pub mod context_section;
pub mod parity_to_landmine;
pub mod recovery_landmines;
pub mod spec_to_note;
