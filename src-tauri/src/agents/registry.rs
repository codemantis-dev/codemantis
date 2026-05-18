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

use super::{AgentAdapter, AgentId};

/// Phase 1 Session 1: empty. Subsequent sessions push adapters here.
static REGISTRY: LazyLock<Vec<Arc<dyn AgentAdapter>>> = LazyLock::new(Vec::new);

/// Look up an adapter by id. Returns `None` if not yet registered (Phase 1
/// Session 1 returns `None` for every id).
pub fn get(agent_id: AgentId) -> Option<Arc<dyn AgentAdapter>> {
    REGISTRY
        .iter()
        .find(|a| a.agent_id() == agent_id)
        .cloned()
}

/// Enumerate all registered adapter ids. Useful for capability-driven UI
/// (provider picker) and for tests.
pub fn registered_ids() -> Vec<AgentId> {
    REGISTRY.iter().map(|a| a.agent_id()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase1_session1_registry_is_empty() {
        // Once Session 2 lands ClaudeCodeAdapter, this becomes
        // `assert_eq!(registered_ids(), vec![AgentId::ClaudeCode]);`
        assert!(registered_ids().is_empty());
    }

    #[test]
    fn lookup_returns_none_when_empty() {
        assert!(get(AgentId::ClaudeCode).is_none());
    }
}
