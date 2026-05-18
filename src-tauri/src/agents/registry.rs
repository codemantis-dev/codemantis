//! Static registry of available agent adapters.
//!
//! Session 1 (this commit) ships the registry shape with no entries. Session 2
//! populates it with `ClaudeCodeAdapter` once the mechanical move from
//! `crate::claude::*` to `crate::agents::claude_code::*` has landed. Phase 2
//! adds `CodexAdapter`.
//!
//! Lookups are `AgentId` → `Arc<dyn AgentAdapter>`. The registry is built
//! lazily and shared across all callers.

use std::sync::{Arc, LazyLock};

use super::claude_code::ClaudeCodeAdapter;
use super::{AgentAdapter, AgentId};

/// The registered adapters. Phase 1: Claude Code only. Phase 2 pushes
/// `CodexAdapter` here.
static REGISTRY: LazyLock<Vec<Arc<dyn AgentAdapter>>> =
    LazyLock::new(|| vec![Arc::new(ClaudeCodeAdapter::new()) as Arc<dyn AgentAdapter>]);

/// Look up an adapter by id. Returns `None` if not yet registered (Phase 1
/// Session 1 returns `None` for every id).
pub fn get(agent_id: AgentId) -> Option<Arc<dyn AgentAdapter>> {
    REGISTRY
        .iter()
        .find(|a| a.agent_id() == agent_id)
        .cloned()
}

/// Enumerate all registered adapter ids. First consumed by the Phase 2
/// capability-driven UI (provider picker); also used by the tests below.
#[allow(dead_code)]
pub fn registered_ids() -> Vec<AgentId> {
    REGISTRY.iter().map(|a| a.agent_id()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase1_registry_has_exactly_claude_code() {
        assert_eq!(registered_ids(), vec![AgentId::ClaudeCode]);
    }

    #[test]
    fn lookup_resolves_claude_code_adapter() {
        let adapter = get(AgentId::ClaudeCode).expect("Claude Code must be registered");
        assert_eq!(adapter.agent_id(), AgentId::ClaudeCode);
        assert_eq!(adapter.capabilities().display_name, "Claude Code");
    }
}
