// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Semantic Evidence Parser
// ═══════════════════════════════════════════════════════════════════════
//
// Phase C.2. Walks a worker's verify-mode response and extracts a
// structured `{ label, verdict, evidenceSnippet, commandText, codeBlock }`
// record per check item. The orchestrator uses these structured records
// instead of grepping for fragile literal shapes (`$ command → output`)
// when grading the response.
//
// Design goals:
//   - Tolerant of presentation shape (markdown table, fenced code block,
//     prose with the data, the canonical `$ cmd → output` line).
//   - Pure: no I/O, no state, easy to test.
//   - Cheap: regex-only, no AST parsing.
//   - Best-effort: never throws; returns partial / empty records for
//     items we can't locate.

export interface ParsedEvidence {
  /** The check label this evidence is for. */
  label: string;
  /** Worker's stated verdict: PASS / FAIL / SKIPPED / N/A / UNKNOWN. */
  verdict: "PASS" | "FAIL" | "SKIPPED" | "N/A" | "UNKNOWN";
  /** The full line containing the verdict, useful for the debug log. */
  verdictLine: string | null;
  /** A short snippet of evidence text near the verdict line (≤500 chars). */
  evidenceSnippet: string | null;
  /** Detected command string, if any. */
  commandText: string | null;
  /** Detected fenced code block contents, if any. */
  codeBlock: string | null;
  /** Detected file:line citations in the vicinity. */
  fileLineCitations: string[];
  /** Detected mock list (from `mocks=...`), if any. */
  mocks: string[] | null;
  /**
   * Detected BrowserMCP tool calls in the evidence window. Non-empty when
   * the worker presented a browser-action sequence (`browser_navigate`,
   * `browser_click`, `browser_type`, `browser_snapshot`, etc.). When this
   * is non-empty AND `mocks` is null, the parser implies `mocks=["none"]`
   * because the browser is real — see `[behavioral capability=browser-mcp]`
   * in the verify-mode preamble. Plan:
   * ~/.claude/plans/analyse-this-why-refactored-yao.md
   */
  browserActionCalls: string[];
}

const VERDICT_PATTERN =
  /\b(PASS|FAIL|SKIPPED|SKIP|N\/A)\b/;
// Note: case-SENSITIVE. The contract specifies uppercase verdicts. Using
// `/i` was matching the word "pass" inside labels like "Tests pass" and
// returning the wrong verdict.

const COMMAND_PATTERN = /(?:^|\s)\$\s+([^\n→]+?)(?:\s+→|\s*$)/m;
const CODE_BLOCK_PATTERN = /```[\w-]*\n([\s\S]+?)```/;
const FILE_LINE_PATTERN = /\b[\w./@-]+\.(?:ts|tsx|rs|py|sql|md|json|yaml|yml|toml):\d+(?:-\d+)?/g;
const MOCKS_PATTERN = /mocks\s*=\s*([\w,.\s|/_-]+?)(?:[\s.;)]|$)/i;
/**
 * BrowserMCP tool-call detector. Catches the canonical name shapes:
 *   - `mcp__browsermcp__browser_navigate` (fully-qualified MCP tool name)
 *   - `browser_navigate(...)`, `browser_click(...)`, etc.
 *   - plain mentions like `$ browser_snapshot → ok` in the verify-mode preamble's
 *     browser-action shape (see guide-verify-prompt.ts).
 * Matches the action verb only — caller need not reproduce arguments.
 */
const BROWSER_ACTION_PATTERN =
  /\b(?:mcp__browsermcp__)?browser_(navigate|click|type|press_key|hover|snapshot|screenshot|select_option|go_back|go_forward|wait|get_console_logs)\b/g;

function normalizeLabelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\[[a-z-]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the verdict from a line by ONLY looking at the text after the
 * first em dash, en dash, or hyphen separator. This avoids matching
 * lowercase "pass" inside labels like "Tests pass".
 */
function extractVerdictAfterSeparator(line: string): string | null {
  // Common separator: " — ", " - ", " – ", or " : "
  const sepMatch = line.match(/[—–\-:]\s+(.*)$/);
  const tail = sepMatch ? sepMatch[1] : line;
  const m = tail.match(VERDICT_PATTERN);
  return m ? m[1] : null;
}

/**
 * Find the line in `response` that introduces `label`'s verdict. We look
 * for the first line that contains both:
 *   - the label's first 3 words (case-insensitive)
 *   - a verdict word (PASS / FAIL / SKIPPED / N/A)
 */
function findVerdictLine(response: string, label: string): string | null {
  const norm = normalizeLabelKey(label);
  // For very short labels (1–2 chars), fall back to a "{N}. <label>"
  // pattern; "A", "B", "C" matches by position only.
  const firstWords = norm.split(" ").slice(0, 3).join(" ");
  if (firstWords.length < 2) return null;
  const escaped = firstWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelRe = new RegExp(`\\b${escaped}\\b`, "i");

  const lines = response.split(/\r?\n/);
  for (const line of lines) {
    if (labelRe.test(line) && extractVerdictAfterSeparator(line) !== null) {
      return line.trim();
    }
  }
  for (const line of lines) {
    if (labelRe.test(line)) return line.trim();
  }
  return null;
}

/**
 * Parse the worker's response into one ParsedEvidence record per label.
 * Order is preserved (mirrors the order of the input labels).
 */
export function parseEvidence(
  response: string,
  labels: string[],
): ParsedEvidence[] {
  if (!response || labels.length === 0) {
    return labels.map((label) => ({
      label,
      verdict: "UNKNOWN" as const,
      verdictLine: null,
      evidenceSnippet: null,
      commandText: null,
      codeBlock: null,
      fileLineCitations: [],
      mocks: null,
      browserActionCalls: [],
    }));
  }

  const out: ParsedEvidence[] = [];
  const lines = response.split(/\r?\n/);

  for (const label of labels) {
    const verdictLine = findVerdictLine(response, label);
    let verdict: ParsedEvidence["verdict"] = "UNKNOWN";
    if (verdictLine) {
      const verdictRaw = extractVerdictAfterSeparator(verdictLine);
      if (verdictRaw) {
        const v = verdictRaw.toUpperCase();
        verdict =
          v === "PASS"
            ? "PASS"
            : v === "FAIL"
              ? "FAIL"
              : v === "SKIP" || v === "SKIPPED"
                ? "SKIPPED"
                : v === "N/A"
                  ? "N/A"
                  : "UNKNOWN";
      }
    }

    // Find the index of the verdict line so we can capture surrounding
    // context (the next ~10 lines or until the next verdict line) as
    // evidenceSnippet.
    let snippet: string | null = null;
    let codeBlock: string | null = null;
    let commandText: string | null = null;
    let fileLineCitations: string[] = [];
    let mocks: string[] | null = null;
    let browserActionCalls: string[] = [];

    if (verdictLine) {
      const lineIdx = lines.findIndex((l) => l.trim() === verdictLine);
      const start = lineIdx >= 0 ? lineIdx : 0;
      const end = Math.min(lines.length, start + 12);
      // Stop at the next verdict line to keep context tight.
      let stopAt = end;
      for (let i = start + 1; i < end; i++) {
        if (
          extractVerdictAfterSeparator(lines[i]) !== null &&
          /^\s*\d+\./.test(lines[i])
        ) {
          stopAt = i;
          break;
        }
      }
      const window = lines.slice(start, stopAt).join("\n");
      snippet = window.slice(0, 500);

      const cb = CODE_BLOCK_PATTERN.exec(window);
      if (cb) codeBlock = cb[1].trim().slice(0, 400);

      const cmd = COMMAND_PATTERN.exec(window);
      if (cmd) commandText = cmd[1].trim().slice(0, 240);

      const cites = window.match(FILE_LINE_PATTERN);
      if (cites) fileLineCitations = Array.from(new Set(cites)).slice(0, 6);

      const mm = MOCKS_PATTERN.exec(window);
      if (mm) {
        mocks = mm[1]
          .split(/[,|\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      // Detect BrowserMCP tool calls. Reset lastIndex so the /g regex
      // doesn't carry state across loop iterations.
      BROWSER_ACTION_PATTERN.lastIndex = 0;
      const actions = new Set<string>();
      let bm: RegExpExecArray | null;
      while ((bm = BROWSER_ACTION_PATTERN.exec(window)) !== null) {
        actions.add(`browser_${bm[1]}`);
      }
      if (actions.size > 0) {
        browserActionCalls = Array.from(actions);
        // Browser-action evidence implies `mocks=none` — the browser is
        // real. Only fill this default when the worker didn't supply an
        // explicit mocks tag.
        if (mocks === null) mocks = ["none"];
      }
    }

    out.push({
      label,
      verdict,
      verdictLine,
      evidenceSnippet: snippet,
      commandText,
      codeBlock,
      fileLineCitations,
      mocks,
      browserActionCalls,
    });
  }

  return out;
}

/**
 * Summarize a ParsedEvidence array as a compact log line for the debug
 * surface. Format:
 *
 *   "[5 items: PASS=3 FAIL=1 SKIP=1 UNKNOWN=0 · cmd=4 code=2 cite=8 · mocks=httpClient,fs]"
 */
export function summarizeParsedEvidence(entries: ParsedEvidence[]): string {
  let pass = 0,
    fail = 0,
    skip = 0,
    unknown = 0;
  let cmd = 0,
    code = 0,
    cite = 0;
  const mocksSeen = new Set<string>();
  for (const e of entries) {
    if (e.verdict === "PASS") pass++;
    else if (e.verdict === "FAIL") fail++;
    else if (e.verdict === "SKIPPED") skip++;
    else unknown++;
    if (e.commandText) cmd++;
    if (e.codeBlock) code++;
    cite += e.fileLineCitations.length;
    if (e.mocks) for (const m of e.mocks) mocksSeen.add(m);
  }
  const mocksList = mocksSeen.size > 0 ? Array.from(mocksSeen).join(",") : "none";
  return `[${entries.length} items: PASS=${pass} FAIL=${fail} SKIP=${skip} UNKNOWN=${unknown} · cmd=${cmd} code=${code} cite=${cite} · mocks=${mocksList}]`;
}
