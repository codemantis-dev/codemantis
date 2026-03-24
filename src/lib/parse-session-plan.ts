// ═══════════════════════════════════════════════════════════════════════
// Session Plan Parser — extracts structured data from spec markdown
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedSession {
  index: number;
  name: string;
  scope: string;
  readSections: string;
  files: string[];
  prompt: string;
  verifyChecks: string[];
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
  const titleMatch = specMarkdown.match(
    /^#\s+(.+?)(?:\s*(?:—|-)\s*(?:Requirements |Feature )?Specification)/m,
  );
  if (!titleMatch) return null;
  const title = titleMatch[1].trim();

  // --- Step 2: Find the Session Plan section ---
  // Look for "## 10. Session Plan" or "## Session Plan" (flexible numbering)
  const sectionPattern = /^##\s+(?:\d+\.\s+)?Session Plan(?:\s*—.*)?$/m;
  const sectionMatch = specMarkdown.match(sectionPattern);
  if (!sectionMatch || sectionMatch.index === undefined) return null;

  // Extract everything from the Session Plan heading to the next ## heading
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const nextSectionMatch = specMarkdown.slice(sectionStart).match(/^##\s+/m);
  const sectionEnd = nextSectionMatch?.index
    ? sectionStart + nextSectionMatch.index
    : specMarkdown.length;
  const sectionContent = specMarkdown.slice(sectionStart, sectionEnd);

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
  const verifyChecks: string[] = [];
  const verifySection = chunk.match(
    /\*\*Verify\b[^*]*\*\*[:\s]*\n((?:\s*-\s*\[[\sx]\].*\n?)+)/i,
  );
  if (verifySection) {
    const checkLines = verifySection[1].matchAll(/^\s*-\s*\[[\sx]?\]\s*(.+)/gm);
    for (const m of checkLines) {
      verifyChecks.push(m[1].trim());
    }
  }
  // Also check for the last session's audit-style verify block
  if (verifyChecks.length === 0) {
    const auditVerify = chunk.match(
      /\*\*Verify\s*\(full\s+audit\)[^*]*\*\*[:\s]*(?:.*\n)*?\s*```[^\n]*\n([\s\S]*?)```/i,
    );
    if (auditVerify) {
      verifyChecks.push(`Run Verification Audit: ${auditVerify[1].trim().split("\n")[0]}`);
    }
  }

  // --- Validation: prompt is REQUIRED, everything else is nice-to-have ---
  if (!prompt) {
    console.warn(`[parseSessionPlan] Session ${index} has no prompt block`);
    return null;
  }

  return { index, name, scope, readSections, files, prompt, verifyChecks };
}
