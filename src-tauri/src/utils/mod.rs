pub mod paths;
pub mod pid_tracker;

// Phase 1 Session 2: the Claude-specific CLI helpers moved to
// `crate::agents::claude_code::*`. These re-exports keep the legacy
// `crate::utils::{claude_detection,cli_handshake_probe,cli_version}` paths
// resolving for command-layer callers until Session 3 pivots them. Removed in
// Session 5.
pub use crate::agents::claude_code::{claude_detection, cli_handshake_probe, cli_version};
