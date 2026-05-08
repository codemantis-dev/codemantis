// ═══════════════════════════════════════════════════════════════════════
// Spec Writer — Prompt constants and builders
// Extracted from useSpecConversation.ts (HIGH-5 audit)
//
// This file is now a barrel — the contents have been split into the
// `spec-prompts/` directory. Public API is unchanged: every existing
// `import { … } from "../lib/spec-prompts"` continues to resolve here.
// ═══════════════════════════════════════════════════════════════════════

export { NEW_APP_PROMPT } from "./spec-prompts/new-app-mode";
export { FEATURE_MODE_PROMPT } from "./spec-prompts/feature-mode";
export {
  SPEC_READY_PATTERNS,
  SPEC_START_PATTERN,
  AUDIT_START_PATTERN,
  AUDIT_FILE_PATTERN,
  FILE_REQUEST_PATTERN,
  isLikelySpecDocument,
} from "./spec-prompts/spec-detection";
export { buildSystemPrompt } from "./spec-prompts/build-system-prompt";
export { buildClaudeCodePrompt } from "./spec-prompts/build-claude-code-prompt";
