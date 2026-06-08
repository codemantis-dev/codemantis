/**
 * Model context window lookup utility.
 *
 * Resolves the context window size for a given model identifier.
 * Priority: CLI-reported value > model name pattern > settings default > 200K fallback.
 */

/** Known context window sizes by model identifier pattern.
 *  Order matters — first match wins, so specific patterns must come first. */
const MODEL_CONTEXT_WINDOWS: { pattern: RegExp; contextWindow: number }[] = [
  // Explicit 1M context marker (e.g., "opus[1m]", "sonnet[1m]", "claude-opus-4-8[1m]")
  { pattern: /\[1m\]/i, contextWindow: 1_000_000 },
  // Opus family (base context)
  { pattern: /opus/i, contextWindow: 200_000 },
  // Sonnet family
  { pattern: /sonnet/i, contextWindow: 200_000 },
  // Haiku family
  { pattern: /haiku/i, contextWindow: 200_000 },
];

/** Absolute fallback when nothing else matches. */
const FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * Look up the context window size for a model identifier.
 *
 * @param model - The model ID string (e.g., "claude-opus-4-8", "opus[1m]", "sonnet")
 * @param settingsDefault - Optional default from user settings (overrides pattern fallback)
 * @returns Context window size in tokens
 */
export function getContextWindowForModel(
  model: string | null | undefined,
  settingsDefault?: number,
): number {
  if (model) {
    for (const { pattern, contextWindow } of MODEL_CONTEXT_WINDOWS) {
      if (pattern.test(model)) return contextWindow;
    }
  }
  return settingsDefault ?? FALLBACK_CONTEXT_WINDOW;
}
