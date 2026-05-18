pub mod paths;
pub mod pid_tracker;

// The Claude-specific CLI helpers (claude_detection, cli_handshake_probe,
// cli_version) live under `crate::agents::claude_code::*` as of Phase 1
// Session 2 — they are agent-specific, not generic utils.
