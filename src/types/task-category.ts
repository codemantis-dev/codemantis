/**
 * Task categories for per-task agent routing (v1.5.0 Phase 1).
 *
 * Each category is a distinct kind of work that spawns a local-CLI
 * session. The user can set a default agent per category in
 * Settings → Agents → Per-task defaults; the resolver
 * (`src/lib/agent-resolver.ts`) maps a category to a concrete
 * `AgentId` at spawn time.
 *
 * After 15 June 2026 Anthropic moves `claude -p` headless onto the
 * metered Agent-SDK pool while Codex stays bundled with the user's
 * ChatGPT subscription — per-task routing lets users put cheap
 * iteration work on Codex and reserve Claude for surgical jobs.
 */
// NOTE — Self-Drive is intentionally NOT a task category. Self-Drive
// attaches to a session the user already opened (it never spawns its
// own session — verified: selfDriveStore only ever calls
// `attachSession`). So Self-Drive inherits whichever agent the
// attached main-chat session runs on; routing it separately would be
// a dropdown that does nothing. To run Self-Drive on Codex, route
// "main_chat" to Codex and start Self-Drive on that session.
export type TaskCategory =
  | "main_chat"
  | "assistant"
  | "spec_writer"
  | "help";

/** Iteration order for the settings table — also the canonical list. */
export const TASK_CATEGORIES: readonly TaskCategory[] = [
  "main_chat",
  "assistant",
  "spec_writer",
  "help",
] as const;

/** Display metadata for the Settings → Agents per-task table. */
export const TASK_CATEGORY_META: Record<
  TaskCategory,
  { label: string; description: string }
> = {
  main_chat: {
    label: "Main chat sessions",
    description: "The primary coding session opened for a project.",
  },
  assistant: {
    label: "Assistant tabs",
    description: "Quick side-questions in the right-panel Assistant.",
  },
  spec_writer: {
    label: "SpecWriter",
    description: "Spec + audit conversations in the SpecWriter panel.",
  },
  help: {
    label: "Help session",
    description: "The in-app Help assistant (defaults to Claude + Haiku).",
  },
};
