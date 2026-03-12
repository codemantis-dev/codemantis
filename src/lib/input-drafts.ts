/** Module-level draft caches for input fields — avoids putting keystrokes through Zustand */

/** Chat input drafts keyed by sessionId */
export const inputDrafts = new Map<string, string>();

/** Assistant panel input drafts keyed by assistantId */
export const assistantInputDrafts = new Map<string, string>();
