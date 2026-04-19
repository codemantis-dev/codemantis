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
  // Accepts: "— Specification", "— Requirements Specification", "— Feature Specification",
  //          "— Implementation Plan", "— Implementation Specification"
  const titleMatch = specMarkdown.match(
    /^#\s+(.+?)\s*(?:—|-)\s*(?:(?:Requirements |Feature |Implementation )?Specification|Implementation Plan)/m,
  );
  if (!titleMatch) return null;
  const title = titleMatch[1].trim();

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
    // for ### Session N: blocks (common in Implementation Plan format)
    sectionContent = specMarkdown;
  }

  // --- Step 3: Split into individual sessions ---
  // Each session starts with "### Session N:"
  const sessionChunks = sectionContent.split(/^###\s+Session\s+\d+/m).slice(1);
  if (sessionChunks.length === 0) return null;

  // --- Step 4: Parse each session ---
  const sessions: ParsedSession[] = [];

  for (let i = 0; i < sessionChunks.length; i++) {
    const chunk = sessionChunks[i];
    const session = parseOneSession(chunk, i + 1);
    if (!session) {
      // If ANY session fails to parse, abort the entire guide
      console.warn(`[parseSessionPlan] Failed to parse session ${i + 1}, aborting guide`);
      return null;
    }
    sessions.push(session);
  }

  if (sessions.length < 2) return null; // A single-session plan doesn't need a guide

  return { title, sessions };
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
