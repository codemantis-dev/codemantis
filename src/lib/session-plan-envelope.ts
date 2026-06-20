// ═══════════════════════════════════════════════════════════════════════
// Session Plan Envelope — structured, regex-free recovery contract
//
// When the strict regex parser (`parseSessionPlan`) can't recognize a spec's
// multi-session plan, we ask the AI that wrote it to hand the plan back in a
// machine-readable form. This module owns:
//   • the recovery PROMPT the model is asked to satisfy,
//   • extraction of the AI's reply into a ParsedSessionPlan — preferring a
//     JSON envelope (regex-free), falling back to re-parsing corrected
//     markdown, and finally to a degraded single-session plan,
//   • the degraded fallback itself.
//
// DESIGN: recovery NEVER returns null. A usable degraded guide beats a
// dead-end. Validation here is SCHEMA-only (the shape of the JSON), never
// content heuristics — moving the decision out of brittle code and into the
// AI is the whole point. See plan:
//   ~/.claude/plans/again-specwriter-creates-a-humble-scone.md
// and memory feedback_ai_native_over_matching.
// ═══════════════════════════════════════════════════════════════════════
import {
  parseSessionPlan,
  type ParsedSession,
  type ParsedSessionPlan,
} from "./parse-session-plan";

/**
 * Marker that opens the fenced JSON envelope the recovery model emits.
 * Mirrors `AUDIT_PATCH_MARKER` in useSpecConversationClaude — a recognizable
 * sentinel the extractor can anchor on.
 */
export const GUIDE_RECOVERY_MARKER = "<!-- SESSION-PLAN-JSON -->";

/** How the recovered plan was obtained — surfaced so the UI can phrase the toast. */
export type RecoverySource = "envelope" | "markdown" | "degraded";

export interface ExtractedPlan {
  plan: ParsedSessionPlan;
  /** True when we fell back to the single-session degraded plan. */
  degraded: boolean;
  source: RecoverySource;
  /**
   * Canonical spec markdown that round-trips through the strict parser —
   * present ONLY when the model returned corrected markdown (`source ===
   * "markdown"`). Null for the envelope/degraded paths since there is no
   * authoritative markdown to write back. Drives the "Save corrected
   * version" toast action.
   */
  correctedMarkdown: string | null;
}

/** First `# ` heading, used as the plan title fallback. */
function specTitle(specMarkdown: string): string {
  return (specMarkdown.match(/^#\s+(.+?)\s*$/m)?.[1] ?? "Specification").trim();
}

/**
 * Build the recovery instruction handed to the AI (in-band on the CLI, or as
 * the user prompt for the API command). Asks for the JSON envelope as the
 * primary, regex-free contract; corrected markdown is accepted as a fallback
 * by the extractor.
 */
export function buildRecoveryPrompt(
  specMarkdown: string,
  diagnosis: string,
  filename: string,
): string {
  return [
    "The implementation spec you produced could not be parsed into a runnable multi-session guide.",
    "",
    `Parser diagnosis: ${diagnosis}`,
    "",
    `Return the session plan as a JSON object inside a fenced code block whose first line is exactly \`${GUIDE_RECOVERY_MARKER}\`. Shape:`,
    "",
    "```",
    GUIDE_RECOVERY_MARKER,
    "{",
    '  "title": "<spec title>",',
    '  "sessions": [',
    "    {",
    '      "title": "<short session title>",',
    '      "prompt": "<the FULL instruction Claude Code should receive to implement this session>",',
    '      "scope": "<one-line scope, optional>",',
    '      "readSections": "<which spec sections to read, optional>",',
    '      "files": ["path/one.ts", "path/two.ts"],',
    '      "verify": ["<verification check>", "..."]',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Rules:",
    `- One entry per implementable session, in order. Use the spec saved as \`${filename}\` as the source of truth.`,
    "- `prompt` is REQUIRED for every session and must be a concrete, self-contained instruction — never empty.",
    "- Do NOT invent work. Derive each session's prompt from the spec's existing Scope / Read sections / Files / Session Plan.",
    "- Skip pure gates (Phase 0) and audit-only wrap-ups; include every session that ships code.",
    "- Output ONLY the fenced JSON block. No prose before or after it.",
    "",
    "--- SPEC START ---",
    specMarkdown,
    "--- SPEC END ---",
  ].join("\n");
}

interface RawEnvelopeSession {
  title?: unknown;
  prompt?: unknown;
  scope?: unknown;
  readSections?: unknown;
  files?: unknown;
  verify?: unknown;
}
interface RawEnvelope {
  title?: unknown;
  sessions?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/**
 * Locate the JSON object emitted by the recovery model. Anchors on
 * `GUIDE_RECOVERY_MARKER` when present; otherwise accepts a reply that is
 * itself bare JSON (starts with `{`). Performs a string-aware balanced-brace
 * scan so braces inside JSON string values never end the object early.
 * Returns the raw JSON substring, or null when nothing plausible is found.
 */
function extractEnvelopeJson(modelText: string): string | null {
  // Anchor after the marker when present; otherwise scan from the start for
  // the first `{`. Scanning is safe: a non-JSON `{` (e.g. spec pseudo-JSON
  // with unquoted keys) fails JSON.parse and the caller falls through to the
  // markdown / degraded paths.
  const markerIdx = modelText.indexOf(GUIDE_RECOVERY_MARKER);
  const searchFrom = markerIdx >= 0 ? markerIdx + GUIDE_RECOVERY_MARKER.length : 0;

  const start = modelText.indexOf("{", searchFrom);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < modelText.length; i++) {
    const ch = modelText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return modelText.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Build a ParsedSessionPlan from a JSON envelope in the model reply. Returns
 * null when there is no valid envelope (caller falls back to markdown /
 * degraded). Validation is SCHEMA-only: an object with a `sessions` array,
 * each session carrying a non-empty string `prompt`. No content heuristics.
 */
function planFromEnvelope(
  modelText: string,
  fallbackTitle: string,
): ParsedSessionPlan | null {
  const json = extractEnvelopeJson(modelText);
  if (!json) return null;

  let raw: RawEnvelope;
  try {
    raw = JSON.parse(json) as RawEnvelope;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions)) return null;

  const sessions: ParsedSession[] = [];
  for (const entry of raw.sessions as RawEnvelopeSession[]) {
    if (!entry || typeof entry !== "object") continue;
    const prompt = asString(entry.prompt).trim();
    if (!prompt) continue; // `prompt` is the one hard requirement.
    const name = asString(entry.title).trim();
    sessions.push({
      index: sessions.length + 1,
      name,
      nameIsFallback: name ? undefined : true,
      scope: asString(entry.scope).trim(),
      readSections: asString(entry.readSections).trim(),
      files: asStringArray(entry.files),
      prompt,
      verifyChecks: asStringArray(entry.verify).map((label) => ({ label })),
      verificationPrompt: null,
    });
  }
  if (sessions.length === 0) return null;

  const title = asString(raw.title).trim() || fallbackTitle;
  return { title, sessions };
}

/**
 * A usable single-session guide for when even AI recovery can't produce a
 * structured plan. "Senior advisor, never gatekeeper" — recognition always
 * yields something runnable. See memory feedback_specwriter_senior_advisor.
 */
export function buildDegradedPlan(
  specMarkdown: string,
  filename: string,
): ParsedSessionPlan {
  const prompt = [
    `Read the specification at \`docs/specs/${filename}\` (or wherever it is saved in this project) in full.`,
    "",
    "Implement the entire specification end to end. Work through every section in order — data model, routes, components, API/data layer, error handling, and the implementation checklist. Add or update tests as the spec's testing standards require.",
    "",
    "When done, re-read the spec and verify your implementation matches every section.",
  ].join("\n");

  return {
    title: specTitle(specMarkdown),
    sessions: [
      {
        index: 1,
        name: "Implement the full specification",
        scope: "Implement the entire spec in one pass.",
        readSections: "Entire spec",
        files: [],
        prompt,
        verifyChecks: [],
        verificationPrompt: null,
      },
    ],
  };
}

/**
 * Turn a recovery model reply into a ParsedSessionPlan. NEVER returns null:
 *   1. Regex-free JSON envelope the model emitted, else
 *   2. corrected markdown re-parsed by the strict parser, else
 *   3. a degraded single-session plan.
 */
export function extractRecoveredPlan(
  modelText: string,
  specMarkdown: string,
  filename: string,
): ExtractedPlan {
  const fallbackTitle = specTitle(specMarkdown);

  // 1. Structured envelope — regex-free, trust the AI's structure.
  const fromEnvelope = planFromEnvelope(modelText, fallbackTitle);
  if (fromEnvelope) {
    return {
      plan: fromEnvelope,
      degraded: false,
      source: "envelope",
      correctedMarkdown: null,
    };
  }

  // 2. The model returned corrected markdown — re-parse it.
  if (modelText.trim()) {
    const fromMarkdown = parseSessionPlan(modelText);
    if (fromMarkdown) {
      return {
        plan: fromMarkdown,
        degraded: false,
        source: "markdown",
        correctedMarkdown: modelText,
      };
    }
  }

  // 3. Never hard-fail — a usable single-session guide.
  return {
    plan: buildDegradedPlan(specMarkdown, filename),
    degraded: true,
    source: "degraded",
    correctedMarkdown: null,
  };
}
