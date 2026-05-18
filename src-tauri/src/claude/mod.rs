//! Legacy `crate::claude::*` facade.
//!
//! Phase 1 Session 2 moved the real implementation to
//! `crate::agents::claude_code::*`. This module is a thin re-export shim so
//! the ~18 existing command-layer callers keep compiling unchanged while
//! Session 3 pivots them onto the `AgentAdapter` trait. The shim — and this
//! whole directory — is deleted in Session 5 (spec §4.1 layer 5 / §4.3 audit:
//! `grep -rn "use crate::claude::" src-tauri/src` must then return zero).
//!
//! Do not add new code here. New work goes in `agents/claude_code/`.

// Some submodules are only reached through the shim in `#[cfg(test)]` paths
// (e.g. `message_router::classify_permission_mode`) so a plain `cargo build`
// sees them as unused re-exports. The shim is deleted in Session 5 anyway.
#[allow(unused_imports)]
pub use crate::agents::claude_code::{
    approval_server, event_types, message_router, process, session, stream_parser,
};
