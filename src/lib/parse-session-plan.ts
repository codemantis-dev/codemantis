// ═══════════════════════════════════════════════════════════════════════
// Session Plan Parser — extracts structured data from spec markdown
// ═══════════════════════════════════════════════════════════════════════

export type ParsedCheckKind = "static" | "side-effect" | "behavioral" | "integration";

export interface ParsedCrossSystemAction {
  action: string;
  handler: string;
  /** Optional on-the-wire identifier — see CrossSystemAction.wire. */
  wire?: string;
}

export interface ParsedSession {
  index: number;
  name: string;
  /**
   * True when `name` was synthesized by the parser because the spec heading
   * lacked a descriptive title (`### Session N` with no `: <title>` part).
   * UI / commit code uses this to avoid emitting `Session N: Session N`-style
   * self-referential labels.
   */
  nameIsFallback?: boolean;
  scope: string;
  readSections: string;
  files: string[];
  prompt: string;
  verifyChecks: { label: string; kind?: ParsedCheckKind }[];
  verificationPrompt?: string | null;
  crossSystemActions?: ParsedCrossSystemAction[];
}

/**
 * Strip surrounding markdown/punctuation noise from a derived title fragment
 * and clamp to a sane display width.
 */
function tidyTitleFragment(raw: string, maxLen = 60): string {
  let s = raw.replace(/[`*_]+/g, "").trim();
  // Drop a leading bullet/numbering remnant.
  s = s.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
  // Collapse internal whitespace.
  s = s.replace(/\s+/g, " ");
  if (s.length <= maxLen) return s;
  // Cut at the last word boundary inside the limit so we never dangle a
  // partial word.
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-—]+$/, "").trim();
}

/**
 * Convert a kebab/snake/path filename into a Title-Case-ish phrase usable as
 * a session title (e.g. `tech-stack-edge-function.ts` → `Tech Stack Edge
 * Function`). Returns "" when the input doesn't yield anything readable.
 */
function fileBasenameToTitle(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  // Drop one trailing extension (.ts, .tsx, .test.ts handled below in two
  // passes by stripping again if a leading ".test"/".spec" remains).
  let stem = base.replace(/\.[A-Za-z0-9]+$/, "");
  stem = stem.replace(/\.(test|spec)$/i, "");
  const words = stem.split(/[-_.\s]+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .map((w) => (w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Derive a meaningful session title when the spec heading lacks one.
 * Priority: Scope sentence → first file basename → first prompt line.
 * Returns "" only when none of those sources yielded content (caller decides
 * how to label that — see `parseOneSession`).
 */
export function deriveSessionName(
  scope: string,
  files: readonly string[],
  prompt: string,
): string {
  if (scope) {
    // First clause = up to the first sentence-ending punctuation.
    const clause = scope.split(/[.;]|\s—\s|\s-\s/)[0] ?? scope;
    const tidy = tidyTitleFragment(clause);
    if (tidy) return tidy;
  }
  if (files.length > 0) {
    const head = fileBasenameToTitle(files[0]);
    if (head) {
      return files.length > 1 ? `${head} +${files.length - 1}` : head;
    }
  }
  if (prompt) {
    const firstLine = prompt
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !/^read\s+docs\/specs\//i.test(l));
    if (firstLine) {
      const tidy = tidyTitleFragment(firstLine);
      if (tidy) return tidy;
    }
  }
  return "";
}

/**
 * Returns true when `name` is a "Session N"-style self-reference that
 * shouldn't be appended after `Session N:` in display strings or commit
 * messages. Matches "Session 7", "Session 7:", "Session 7: Session 7", and
 * also a bare numeric "7" or "Session 07".
 */
export function isSelfReferentialName(name: string | null | undefined, index: number): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  // Strip a leading "Session N" prefix (with optional zero-pad + colon) and
  // see if anything remains.
  const stripped = trimmed
    .replace(new RegExp(`^session\\s*0*${index}\\b:?\\s*`, "i"), "")
    .trim();
  if (stripped.length === 0) return true;
  // The recursive `Session N: Session N` pattern.
  return new RegExp(`^session\\s*0*${index}\\b`, "i").test(stripped);
}

/**
 * Strip a `Session N` / `Session N:` self-prefix off `name`, returning the
 * remaining descriptive part. Returns "" if nothing descriptive remains.
 */
export function stripSessionPrefix(
  name: string | null | undefined,
  index: number,
): string {
  if (!name) return "";
  let s = name.trim();
  // Peel off "Session N" / "Session N:" possibly multiple times for the
  // double-up "Session 1: Session 1" case.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(new RegExp(`^session\\s*0*${index}\\b:?\\s*`, "i"), "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Build the canonical display label for a guide session:
 * "Session N: <descriptive>" — or just "Session N" when the descriptive part
 * is empty or self-referential. Used by the guide UI, log entries, commit
 * message construction, and the verify prompt builder so every surface
 * agrees on how a session is named.
 */
export function formatSessionLabel(
  index: number,
  name: string | null | undefined,
): string {
  const clean = stripSessionPrefix(name, index);
  return clean ? `Session ${index}: ${clean}` : `Session ${index}`;
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
 * Optionally an inline `(wire: \`x\`)` metadata token may appear between
 * the action and the arrow to declare an on-the-wire identifier that
 * differs from the action name:
 *   - action: `resolve_checkpoint` (wire: `hitl-respond`) → handler: `…`
 * Returns an empty array if the block is absent.
 *
 * Why this is a first-class parse: Self-Drive uses the list to run a
 * ripgrep-based parity check before marking a session done. A session
 * that ships a caller without a matching handler will be blocked by the
 * check — even if the verifier text claimed PASS — which is the whole
 * point of this feature. The `wire` field lets the gate search for the
 * real on-the-wire string when the spec's action label is a friendlier
 * synonym (e.g. snake_case API verb vs. kebab-case URL slug).
 */
function extractCrossSystemActions(chunk: string): ParsedCrossSystemAction[] {
  const block = chunk.match(
    /\*\*Cross-system\s+actions\s+introduced:\*\*\s*\n((?:\s*-\s*.+\n?)+)/i,
  );
  if (!block) return [];
  const actions: ParsedCrossSystemAction[] = [];
  // Captures: 1=action, 2=optional parenthetical between action and arrow,
  // 3=handler. The parenthetical is parsed for `wire:` separately so a
  // malformed token (e.g. `(wire )`) degrades to "no wire" rather than
  // dropping the whole row.
  const rowRegex = /^\s*-\s*(?:action:\s*)?`?([^`\s→]+)`?\s*(?:\(([^)]*)\))?\s*(?:→|->)\s*(?:handler:\s*)?`?([^`\n]+?)`?\s*$/gim;
  for (const m of block[1].matchAll(rowRegex)) {
    const action = m[1].trim();
    const parenContent = (m[2] ?? "").trim();
    const handler = m[3].trim();
    if (!action || !handler) continue;
    const wireMatch = parenContent.match(/wire\s*:\s*`?([^`\s)]+)`?/i);
    const wire = wireMatch ? wireMatch[1].trim() : undefined;
    actions.push(wire ? { action, handler, wire } : { action, handler });
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
      // are descriptive/gate phases — skip rather than abort.
      if (e.keyword === "Phase") continue;
      // SpecWriter routinely emits a final Session whose only block is
      // **Verify (full audit):** — an audit wrap-up with no implementation
      // prompt. Treat that as a Phase-style skip rather than a parse abort,
      // so the rest of the guide still recognizes.
      if (hasAuditWrapUp(e.body)) continue;
      console.warn(
        `[parseSessionPlan] Session ${e.num} has no Prompt for Claude Code block — aborting guide`,
      );
      return null;
    }
    sessions.push(session);
  }

  if (sessions.length < 2) return null; // A single-session plan doesn't need a guide

  return { title, sessions };
}

/**
 * True if a session body looks like a final audit-style wrap-up. The marker
 * SpecWriter uses for an implementation-prompt-free wrap-up is specifically
 * `**Verify (full audit):**` (with a fenced code block). A session with only
 * a regular `**Verify before next session:**` checklist is a broken session
 * (missing its prompt), NOT an audit wrap-up — that case still aborts.
 */
function hasAuditWrapUp(body: string): boolean {
  return /\*\*Verify\s*\(full\s+audit\)/i.test(body);
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

  // Surface the specific offending Session: a Session block (not a Phase,
  // not an audit wrap-up) that is missing its prompt is the recurring
  // failure mode we want to name explicitly instead of a catch-all.
  const offending = eligible.find(
    (e) =>
      e.keyword === "Session" &&
      !/\*\*Prompt\s+for\s+Claude\s+Code:\*\*\s*\n```/.test(e.body) &&
      !/\*\*Verify\s*\(full\s+audit\)/i.test(e.body),
  );
  if (offending) {
    return `Session ${offending.num} has no \`**Prompt for Claude Code:**\` fenced code block — add one, or mark it as a final wrap-up with \`**Verify (full audit):**\``;
  }

  return "Could not parse the multi-session plan in this spec";
}

function parseOneSession(chunk: string, index: number): ParsedSession | null {
  // Extract session name from the heading remainder
  // Input: ": Database & Infrastructure (~5 files)\n..."
  const nameMatch = chunk.match(/^:\s*(.+?)(?:\s*\(~?\d+\s*files?\))?\s*$/m);
  const headingName = nameMatch?.[1]?.trim() ?? "";
  // Detect when the heading-supplied name is effectively a self-reference
  // (e.g. `### Session 1: Session 1` or `### Session 7: Session 7`) and
  // treat it as "no name" so the fallback derivation kicks in below.
  // We accept ANY `Session \d+` placeholder here — not just one matching
  // `index` — because:
  //   1. The result-array index is sequential and may diverge from the
  //      heading number when the spec contains [DEFER] or Phase blocks.
  //   2. No realistic spec uses literally `Session 12` as a descriptive
  //      title for a different session — it's always a placeholder.
  const headingIsPlaceholder =
    headingName.length === 0 || /^session\s*0*\d+\b:?\s*(?:session\s*0*\d+\b:?\s*)?$/i.test(headingName);
  const headingIsUseful = !headingIsPlaceholder;

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

  // Settle the final session name. When the heading didn't carry a useful
  // descriptive title, derive one from Scope / Files / Prompt so the UI and
  // auto-commit text never emit "Session N: Session N".
  let name: string;
  let nameIsFallback = false;
  if (headingIsUseful) {
    name = headingName;
  } else {
    const derived = deriveSessionName(scope, files, prompt);
    if (derived) {
      name = derived;
      nameIsFallback = true;
    } else {
      // Truly nothing to derive from — leave name empty and let the UI/commit
      // code render just "Session N" without a redundant suffix.
      name = "";
      nameIsFallback = true;
    }
  }

  return {
    index,
    name,
    nameIsFallback: nameIsFallback || undefined,
    scope,
    readSections,
    files,
    prompt,
    verifyChecks,
    verificationPrompt,
    crossSystemActions: crossSystemActions.length > 0 ? crossSystemActions : undefined,
  };
}
