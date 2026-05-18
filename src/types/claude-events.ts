/**
 * Legacy module path. Phase 1 Session 4 renamed this to `agent-events.ts`
 * (the event vocabulary is no longer Claude-specific). This re-export keeps
 * the ~30 existing importers compiling unchanged. New imports should target
 * `./agent-events` directly; this shim is removed once all imports are
 * migrated (a follow-up sweep, tracked for Phase 2).
 */
export * from "./agent-events";
