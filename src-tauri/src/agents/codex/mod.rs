//! OpenAI Codex adapter (Phase 2).
//!
//! Codex is not "Claude with a different binary" — its protocol is
//! bidirectional JSON-RPC 2.0 over stdio (`codex app-server --listen
//! stdio://`) with primitives that have no Claude equivalent: threads,
//! server-initiated approvals, AGENTS.md instead of `--append-system-prompt`.
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md` §2.4.
//!
//! Session boundaries:
//!   * S2 (this commit) — the pure protocol layer: framer, id allocator,
//!     in-flight request bookkeeping, backpressure retry. No subprocess
//!     wiring, no Tauri / AppState coupling.
//!   * S3 — translator (ThreadEvent → NormalizedEvent), approvals, auth
//!     probe.
//!   * S4 — `CodexAdapter` glue + spawn + AGENTS.md ephemeral dir + MCP
//!     config; registered in `agents::registry`.

pub mod client;
pub mod jsonrpc;
pub mod thread_state;
