/**
 * SpecWriter Phase 0b — capability handshake question builder.
 *
 * Pure function. Input: a ProjectCapabilitiesRecord (from the Phase 0a probe).
 * Output: a small batch of questions to surface to the user, targeting only
 * `claimed-unverified` capabilities — i.e. things the probe found indirect
 * evidence for but couldn't prove without a live call. Already-verified or
 * already-absent capabilities never produce questions.
 *
 * Each question is shaped like `AskUserQuestion`'s contract: a short header,
 * a complete question, and 2-4 options. The caller surfaces these to the user
 * (via the existing question UI), collects answers, then dispatches the
 * confirmed capabilities to the Rust live-fire dispatcher.
 *
 * Question budget: 1-4 questions per spec. When more `claimed-unverified`
 * items exist than the budget allows, the builder prioritises by leverage
 * (BrowserMCP first, then DB access, then LLM keys, then everything else).
 *
 * When the user has `selfDriveConfirmCapabilities = false` in settings, the
 * caller skips this step entirely; the probe-inferred record is used as-is.
 *
 * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
 */

import type {
  ProbedCapability,
  ProjectCapabilitiesRecord,
} from "../types/spec-writer";

/** Max questions per spec — matches AskUserQuestion's 1-4 contract. */
export const MAX_HANDSHAKE_QUESTIONS = 4;

/** Leverage rank — lower is more important. Used to trim when over-budget. */
const LEVERAGE_RANK: Record<string, number> = {
  // The headline unlock: turns SKIPPED behavioral checks into real evidence.
  "browser-mcp": 0,
  // DB write access enables [integration] verification with real PATCH/INSERT.
  "db.supabase-service-role": 1,
  // DB read access enables [integration] read-only checks.
  "db.supabase-anon": 2,
  // LLM keys unlock features that need live model calls.
  "llm-key.anthropic": 3,
  "llm-key.openai": 4,
  "llm-key.gemini": 5,
};

export interface HandshakeOption {
  label: string;
  description: string;
  /**
   * What this option means for the capability:
   * - `verify` → run the live-fire and mark verified (or absent if it fails)
   * - `skip` → leave as `claimed-unverified`; verify-mode will demand stronger evidence
   * - `absent` → mark `absent` explicitly so SpecWriter substitutes / DEFERs
   */
  action: "verify" | "skip" | "absent";
}

export interface HandshakeQuestion {
  /** Stable id so the caller can route the answer back to a capability. */
  capabilityId: string;
  /** Short header (max 12 chars per AskUserQuestion contract). */
  header: string;
  /** Full question with question mark. */
  question: string;
  options: HandshakeOption[];
}

/**
 * Build the handshake question for a single capability. Returns `null` when
 * the capability doesn't warrant a user question (verified or absent — or
 * the probe didn't recognise it).
 */
export function buildHandshakeQuestion(
  cap: ProbedCapability,
): HandshakeQuestion | null {
  if (cap.status !== "claimed-unverified") return null;

  switch (cap.id) {
    case "browser-mcp":
      return {
        capabilityId: cap.id,
        header: "BrowserMCP",
        question:
          "I detected BrowserMCP configured. Should the spec plan browser-driven E2E test steps " +
          "(real `browser_click` / `browser_type` / `browser_snapshot` evidence)?",
        options: [
          {
            label: "Yes — verify and use it",
            description:
              "Run a live-fire check (navigate + snapshot). If it works, verify-mode will execute real browser actions.",
            action: "verify",
          },
          {
            label: "No — static evidence only",
            description:
              "Mark BrowserMCP as absent. SpecWriter will substitute static checks or DEFER behavioral items.",
            action: "absent",
          },
        ],
      };

    case "db.supabase-service-role":
      return {
        capabilityId: cap.id,
        header: "DB writes",
        question:
          "I see Supabase service-role credentials. Should [integration] items verify real DB writes (sentinel insert/revert)?",
        options: [
          {
            label: "Yes — verify writes against a sentinel row",
            description:
              "Live-fire writes/reverts a known sentinel row to prove the key works without affecting real data.",
            action: "verify",
          },
          {
            label: "No — leave as claimed-unverified",
            description:
              "Spec keeps integration items but doesn't verify them at write-time. Verify-mode demands explicit proof later.",
            action: "skip",
          },
          {
            label: "Mark absent — no DB writes in spec",
            description:
              "Force the spec to avoid acceptance criteria requiring DB writes. Reads (anon) may still be allowed.",
            action: "absent",
          },
        ],
      };

    case "db.supabase-anon":
      return {
        capabilityId: cap.id,
        header: "DB reads",
        question:
          "I see Supabase anon credentials. Should [integration] items verify real DB reads?",
        options: [
          {
            label: "Yes — verify reads",
            description:
              "Live-fire a GET against the REST API to confirm the anon key works and the project is reachable.",
            action: "verify",
          },
          {
            label: "No — skip DB verification",
            description: "Leave the capability as claimed-unverified.",
            action: "skip",
          },
        ],
      };

    case "llm-key.anthropic":
      return {
        capabilityId: cap.id,
        header: "Anthropic",
        question:
          "I see an Anthropic API key. Should the spec assume live Claude API calls are available?",
        options: [
          {
            label: "Yes — verify the key works",
            description:
              "Live-fire a minimal POST /v1/messages (max_tokens=1) to confirm the key is valid and not rate-limited.",
            action: "verify",
          },
          {
            label: "No — exclude Claude API features",
            description:
              "Mark absent so the spec can't include acceptance criteria requiring Claude API calls.",
            action: "absent",
          },
        ],
      };

    case "llm-key.openai":
      return {
        capabilityId: cap.id,
        header: "OpenAI",
        question:
          "I see an OpenAI API key. Should the spec assume live OpenAI API calls are available?",
        options: [
          {
            label: "Yes — verify the key works",
            description:
              "Live-fire GET /v1/models to confirm the key is valid.",
            action: "verify",
          },
          {
            label: "No — exclude OpenAI features",
            description:
              "Mark absent so the spec can't include acceptance criteria requiring OpenAI calls.",
            action: "absent",
          },
        ],
      };

    case "llm-key.gemini":
      return {
        capabilityId: cap.id,
        header: "Gemini",
        question:
          "I see a Gemini / Google API key. Should the spec assume live Gemini API calls are available?",
        options: [
          {
            label: "Yes — verify the key works",
            description:
              "Live-fire GET /v1beta/models to confirm the key is valid.",
            action: "verify",
          },
          {
            label: "No — exclude Gemini features",
            description:
              "Mark absent so the spec can't include acceptance criteria requiring Gemini calls.",
            action: "absent",
          },
        ],
      };

    default:
      // Unknown claimed-unverified capability — fall back to a generic Y/N.
      return {
        capabilityId: cap.id,
        header: cap.id.slice(0, 12),
        question: `Capability \`${cap.id}\` is claimed-unverified. ${cap.evidence}. Verify it now?`,
        options: [
          {
            label: "Yes — verify",
            description: "Run the recorded verifyMethod to prove the capability is real.",
            action: "verify",
          },
          {
            label: "No — leave unverified",
            description: "Skip; verify-mode handles the lack of proof.",
            action: "skip",
          },
        ],
      };
  }
}

/**
 * Build the full handshake batch for a probed record. Returns up to
 * MAX_HANDSHAKE_QUESTIONS questions, prioritised by leverage. Returns an
 * empty array when nothing needs confirmation — the caller can skip the
 * handshake UI entirely in that case.
 */
export function buildHandshakeQuestions(
  record: ProjectCapabilitiesRecord,
): HandshakeQuestion[] {
  const candidates = record.capabilities
    .filter((c) => c.status === "claimed-unverified")
    .slice()
    .sort((a, b) => {
      const ra = LEVERAGE_RANK[a.id] ?? 100;
      const rb = LEVERAGE_RANK[b.id] ?? 100;
      return ra - rb;
    });

  const questions: HandshakeQuestion[] = [];
  for (const cap of candidates) {
    const q = buildHandshakeQuestion(cap);
    if (q) questions.push(q);
    if (questions.length >= MAX_HANDSHAKE_QUESTIONS) break;
  }
  return questions;
}
