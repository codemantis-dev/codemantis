import type { CliModelInfo } from "../types/agent-events";

/**
 * Codex default model lineup, verified live against the `model/list`
 * JSON-RPC response on codex-cli 0.130.0 (May 2026).
 *
 * Single source of truth for both:
 *   - `components/input/ModelSelector` (chat dropdown, pre-CapabilitiesDiscovered window)
 *   - `components/specwriter/SpecChat` (SpecWriter dropdown when no Codex
 *     session has populated `cliModelCacheStore` yet)
 *
 * The authoritative list always comes from a real `model/list` round-trip
 * — this constant just keeps the UI usable before that's happened.
 */
export const CODEX_FALLBACK_MODELS: CliModelInfo[] = [
  {
    value: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Codex default — balanced speed and reasoning",
    isDefault: true,
  },
  { value: "gpt-5.4", displayName: "GPT-5.4", description: "General-purpose Codex model" },
  { value: "gpt-5.4-mini", displayName: "GPT-5.4-Mini", description: "Smaller / faster" },
  { value: "gpt-5.3-codex", displayName: "GPT-5.3-Codex", description: "Older Codex-tuned model" },
];
