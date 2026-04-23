// ═══════════════════════════════════════════════════════════════════════
// Session Plan Parser — extracts structured data from spec markdown
// ═══════════════════════════════════════════════════════════════════════

export type ParsedCheckKind = "static" | "side-effect" | "behavioral" | "integration";

export interface ParsedCrossSystemAction {
  action: string;
  handler: string;
}

export interface ParsedSession {
  index: number;
  name: string;
  scope: string;
  readSections: string;
  files: string[];
  prompt: string;
  verifyChecks: { label: string; kind?: ParsedCheckKind }[];
  verificationPrompt?: string | null;
  crossSystemActions?: ParsedCrossSystemAction[];
}

/**
 * Extract an optional `[kind]` suffix (or prefix) from a VerifyCheck line.
 * Accepts `[side-effect]`, `[behavioral]`, `[static]`, `[integration]`
 * (case-insensitive); any other bracketed content is treated as part of
 * the label.
 *
 * Returns { label, kind } where kind is undefined for "static" (default).
 */
function extractCheckKind(raw: string): { label: string; kind?: ParsedCheckKind } {
  // Trailing tag: "… thing to verify [side-effect]"
  const tail = raw.match(/^(.*?)\s*\[(static|side-effect|behavioral|integration)\]\s*$/i);
  if (tail) {
    const kind = tail[2].toLowerCase() as ParsedCheckKind;
    return { label: tail[1].trim(), kind: kind === "static" ? undefined : kind };
  }
  // Leading tag: "[side-effect] thing to verify"
  const head = raw.match(/^\s*\[(static|side-effect|behavioral|integration)\]\s*(.+)$/i);
  if (head) {
    const kind = head[1].toLowerCase() as ParsedCheckKind;
    return { label: head[2].trim(), kind: kind === "static" ? undefined : kind };
  }
  return { label: raw.trim() };
}

/**
 * Parse the optional `**Cross-system actions introduced:**` block from a
 * session chunk. Each declared row has the form:
 *   - action: `name` → handler: `path::symbol`
 * or the looser form:
 *   - `name` → `path`
 * Returns an empty array if the block is absent or malformed.
 *
 * Why this is a first-class parse: Self-Drive uses the list to run a
 * ripgrep-based parity check before marking a session done. A session
 * that ships a caller without a matching handler will be blocked by the
 * check — even if the verifier text claimed PASS — which is the whole
 * point of this feature.
 */
function extractCrossSystemActions(chunk: string): ParsedCrossSystemAction[] {
  const block = chunk.match(
    /\*\*Cross-system\s+actions\s+introduced:\*\*\s*\n((?:\s*-\s*.+\n?)+)/i,
  );
  if (!block) return [];
  const actions: ParsedCrossSystemAction[] = [];
  const rowRegex = /^\s*-\s*(?:action:\s*)?`?([^`\s→]+)`?\s*(?:→|->)\s*(?:handler:\s*)?`?([^`\n]+?)`?\s*$/gim;
  for (const m of block[1].matchAll(rowRegex)) {
    const action = m[1].trim();
    const handler = m[2].trim();
    if (action && handler) actions.push({ action, handler });
  }
  return actions;
}

export interface ParsedSessionPlan {
  title: string;
  sessions: ParsedSession[];
}

/**
 * Extracts a Session Plan from a spec markdown document.
 * Returns null if no valid Session Plan is found.
 *
 * DESIGN PRINCIPLE: Fail gracefully. If ANY required field is missing
 * from ANY session, return null. A partial guide is worse than no guide.
 */
export function parseSessionPlan(specMarkdown: string): ParsedSessionPlan | null {
  // --- Step 1: Extract spec title from the # heading ---
  // The real validity gate is a well-formed Session Plan with ≥2 sessions
  // (each with a Prompt for Claude Code block); the title is display metadata.
  // Accept any H1. If it ends with a known kind suffix ("— Specification",
  // "— Implementation Plan", etc.) strip that for a cleaner display string.
  const titleMatch = specMarkdown.match(/^#\s+(.+?)\s*$/m);
  if (!titleMatch) return null;
  const rawTitle = titleMatch[1].trim();
  const kindStrip = rawTitle.match(
    /^(.+?)\s*(?:—|-)\s*(?:(?:Requirements |Feature |Implementation )?Specification|Implementation Plan)\s*$/,
  );
  const title = (kindStrip?.[1] ?? rawTitle).trim();

  // --- Step 2: Find the Session Plan section ---
  // Look for "## 10. Session Plan" or "## Session Plan" (flexible numbering)
  const sectionPattern = /^##\s+(?:\d+\.\s+)?Session Plan(?:\s*—.*)?$/m;
  const sectionMatch = specMarkdown.match(sectionPattern);

  let sectionContent: string;
  if (sectionMatch && sectionMatch.index !== undefined) {
    // Extract everything from the Session Plan heading to the next ## heading
    const sectionStart = sectionMatch.index + sectionMatch[0].length;
    const nextSectionMatch = specMarkdown.slice(sectionStart).match(/^##\s+/m);
    const sectionEnd = nextSectionMatch?.index
      ? sectionStart + nextSectionMatch.index
      : specMarkdown.length;
    sectionContent = specMarkdown.slice(sectionStart, sectionEnd);
  } else {
    // Fallback: no "## Session Plan" wrapper — search the full document
    // for ### Session N: / ### Phase N: blocks
    sectionContent = specMarkdown;
  }

  // --- Step 3: Split into individual sessions ---
  // The LLM commonly emits the implementable units as ### Phase N: inside
  // ## Implementation Checklist, leaving ## Session Plan as a reference
  // table — accept either keyword so the parser sees the substance.
  let entries = harvestEntries(sectionContent);
  if (entries.length === 0 && sectionMatch) {
    // Slice was just a summary table → scan the whole document.
    entries = harvestEntries(specMarkdown);
  }
  if (entries.length === 0) return null;

  // --- Step 4: Parse each entry, skipping gates and deferred phases ---
  const sessions: ParsedSession[] = [];

  for (const e of entries) {
    const firstLine = e.body.split("\n", 1)[0];
    // Phase 0 by convention is a pre-implementation gate (not a session);
    // [DEFER] phases are explicitly out of scope for the current cycle.
    if (/\[DEFER\]/i.test(firstLine)) continue;
    if (e.keyword === "Phase" && e.num === 0) continue;

    const session = parseOneSession(e.body, sessions.length + 1);
    if (!session) {
      // Phase blocks legitimately omit a Prompt for Claude Code when they
      // are descriptive/gate phases — skip rather than abort. Session
      // blocks remain strict: a missing prompt is a real authoring error.
      if (e.keyword === "Phase") continue;
      console.warn(`[parseSessionPlan] Failed to parse session ${e.num}, aborting guide`);
      return null;
    }
    sessions.push(session);
  }

  if (sessions.length < 2) return null; // A single-session plan doesn't need a guide

  return { title, sessions };
}

interface SessionEntry {
  keyword: "Session" | "Phase";
  num: number;
  body: string;
}

const ENTRY_SPLIT_RE = /^###\s+(Session|Phase)\s+(\d+)/m;

function harvestEntries(content: string): SessionEntry[] {
  const tokens = content.split(ENTRY_SPLIT_RE);
  // split with two capturing groups produces: [preamble, kw1, n1, body1, kw2, n2, body2, …]
  const entries: SessionEntry[] = [];
  for (let i = 1; i + 2 < tokens.length; i += 3) {
    entries.push({
      keyword: tokens[i] as "Session" | "Phase",
      num: Number.parseInt(tokens[i + 1], 10),
      body: tokens[i + 2],
    });
  }
  return entries;
}

/**
 * Returns a user-facing reason for why parseSessionPlan returned null, so the
 * Recognize-Guide toast can name the actual failure mode instead of a generic
 * "could not find" message. Intended only for the failure path — the caller
 * should still call parseSessionPlan() first to decide success vs. failure.
 */
export function diagnoseSessionPlanFailure(specMarkdown: string): string {
  if (!specMarkdown.match(/^#\s+.+/m)) {
    return "Spec is missing a top-level `#` title heading";
  }

  let sliceContent = specMarkdown;
  const sectionMatch = specMarkdown.match(
    /^##\s+(?:\d+\.\s+)?Session Plan(?:\s*—.*)?$/m,
  );
  if (sectionMatch && sectionMatch.index !== undefined) {
    const start = sectionMatch.index + sectionMatch[0].length;
    const next = specMarkdown.slice(start).match(/^##\s+/m);
    const end = next?.index ? start + next.index : specMarkdown.length;
    sliceContent = specMarkdown.slice(start, end);
  }

  let entries = harvestEntries(sliceContent);
  if (entries.length === 0 && sectionMatch) {
    entries = harvestEntries(specMarkdown);
  }
  if (entries.length === 0) {
    return "No `### Session N:` or `### Phase N:` blocks found in this spec";
  }

  const eligible = entries.filter((e) => {
    const firstLine = e.body.split("\n", 1)[0];
    if (/\[DEFER\]/i.test(firstLine)) return false;
    if (e.keyword === "Phase" && e.num === 0) return false;
    return true;
  });
  if (eligible.length === 0) {
    return "All Phase/Session blocks were gates or `[DEFER]` — nothing to schedule";
  }

  const withPrompts = eligible.filter((e) =>
    /\*\*Prompt\s+for\s+Claude\s+Code:\*\*\s*\n```/.test(e.body),
  );
  if (withPrompts.length === 0) {
    return "Found Phase/Session blocks but none have a `**Prompt for Claude Code:**` fenced code block";
  }
  if (withPrompts.length < 2) {
    return "Only one usable session found — a guide needs at least 2 sessions";
  }

  return "Could not parse the multi-session plan in this spec";
}

function parseOneSession(chunk: string, index: number): ParsedSession | null {
  // Extract session name from the heading remainder
  // Input: ": Database & Infrastructure (~5 files)\n..."
  const nameMatch = chunk.match(/^:\s*(.+?)(?:\s*\(~?\d+\s*files?\))?\s*$/m);
  const name = nameMatch?.[1]?.trim() ?? `Session ${index}`;

  // Extract **Scope:** line
  const scopeMatch = chunk.match(/\*\*Scope:\*\*\s*(.+)/);
  const scope = scopeMatch?.[1]?.trim() ?? "";

  // Extract **Read sections:** line
  const readMatch = chunk.match(/\*\*Read\s+sections?:\*\*\s*(.+)/i);
  const readSections = readMatch?.[1]?.trim() ?? "";

  // Extract **Files:** list (lines starting with - `)
  const filesSection = chunk.match(/\*\*Files:\*\*\s*\n((?:\s*-\s*.+\n?)+)/);
  const files: string[] = [];
  if (filesSection) {
    const fileLines = filesSection[1].matchAll(/^\s*-\s*`?([^`\n]+)`?/gm);
    for (const m of fileLines) {
      const f = m[1].trim().replace(/\s*\((?:create|modify)\)\s*$/, "");
      if (f) files.push(f);
    }
  }

  // Extract the Claude Code prompt (fenced code block after "Prompt for Claude Code")
  const promptMatch = chunk.match(
    /\*\*Prompt\s+for\s+Claude\s+Code:\*\*\s*\n```[^\n]*\n([\s\S]*?)```/,
  );
  const prompt = promptMatch?.[1]?.trim() ?? "";

  // Extract verify checks (lines with - [ ] or □)
  const verifyChecks: { label: string; kind?: ParsedCheckKind }[] = [];
  const verifySection = chunk.match(
    /\*\*Verify\b[^*]*\*\*[:\s]*\n((?:\s*-\s*\[[\sx]\].*\n?)+)/i,
  );
  if (verifySection) {
    const checkLines = verifySection[1].matchAll(/^\s*-\s*\[[\sx]?\]\s*(.+)/gm);
    for (const m of checkLines) {
      verifyChecks.push(extractCheckKind(m[1].trim()));
    }
  }
  // Also check for the last session's audit-style verify block
  if (verifyChecks.length === 0) {
    const auditVerify = chunk.match(
      /\*\*Verify\s*\(full\s+audit\)[^*]*\*\*[:\s]*(?:.*\n)*?\s*```[^\n]*\n([\s\S]*?)```/i,
    );
    if (auditVerify) {
      verifyChecks.push({
        label: `Run Verification Audit: ${auditVerify[1].trim().split("\n")[0]}`,
      });
    }
  }

  // Extract optional verification prompt (fenced code block after "Verification Prompt")
  const verificationMatch = chunk.match(
    /\*\*Verification\s+Prompt:\*\*\s*\n```[^\n]*\n([\s\S]*?)```/,
  );
  const verificationPrompt = verificationMatch?.[1]?.trim() ?? null;

  // --- Validation: prompt is REQUIRED, everything else is nice-to-have ---
  if (!prompt) {
    console.warn(`[parseSessionPlan] Session ${index} has no prompt block`);
    return null;
  }

  const crossSystemActions = extractCrossSystemActions(chunk);

  return {
    index,
    name,
    scope,
    readSections,
    files,
    prompt,
    verifyChecks,
    verificationPrompt,
    crossSystemActions: crossSystemActions.length > 0 ? crossSystemActions : undefined,
  };
}
