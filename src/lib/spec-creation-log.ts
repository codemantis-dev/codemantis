// ═══════════════════════════════════════════════════════════════════════
// Spec Creation Log — per-section streaming progress used to give the
// model programmatic memory across Claude Code CLI auto-compaction events.
//
// The stream hooks (useSpecConversation* in src/hooks/) call into this
// module on each RAF-batched flush of their stream buffer to detect when a
// heading line has fully arrived. When a new heading appears, the previous
// entry is closed and a new entry is appended (with `postCompaction: true`
// when the run has already been compacted at least once).
//
// On the next non-recheck user turn that follows a compaction, the hooks
// prepend `renderCreationLogRecap(log, compaction)` to the user message so
// the model knows exactly which sections were already written, which one
// it was mid-writing when the compact hit, and which ones came after.
// ═══════════════════════════════════════════════════════════════════════

import type {
  CompactionRunInfo,
  SpecCreationEntry,
  SpecCreationLog,
} from '../types/spec-writer';

/**
 * Heading detected in the streaming buffer. Returned in document order.
 *
 * `byteOffset` is the byte position of the heading line's first character
 * in the source buffer. This lets the caller compute the body bytes between
 * one heading and the next without re-scanning.
 */
export interface DetectedHeading {
  level: 1 | 2 | 3;
  title: string;
  byteOffset: number;
}

/**
 * Scan a streaming spec buffer for fully-arrived H1/H2/H3 headings. A line
 * is "fully arrived" only when it ends with `\n` — partial lines (still
 * streaming) are deliberately skipped to avoid emitting half-headings.
 *
 * Fenced code blocks (` ``` `) are skipped so a `# Title` inside an example
 * doesn't get treated as a real heading.
 */
export function parseHeadingsForLog(buffer: string): DetectedHeading[] {
  const headings: DetectedHeading[] = [];
  let inFence = false;
  let offset = 0;
  // Walk the buffer line-by-line. We deliberately use `indexOf` rather than
  // `split('\n')` so we can track `offset` cheaply AND skip the final
  // partial line (no trailing `\n`).
  while (offset < buffer.length) {
    const nlIdx = buffer.indexOf('\n', offset);
    if (nlIdx === -1) break; // partial line — wait for it to complete
    const line = buffer.slice(offset, nlIdx);
    const lineStart = offset;
    offset = nlIdx + 1;

    // Fence toggling — be permissive about the fence-info string.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length as 1 | 2 | 3;
    const title = m[2];
    headings.push({ level, title, byteOffset: lineStart });
  }
  return headings;
}

/**
 * Advance the creation log to match the current stream buffer state. The
 * returned object describes what changed so the store can apply the right
 * sequence of actions.
 *
 * Contract:
 *  - Closes the previously open entry (if any) when a new heading appears
 *    after it.
 *  - Appends new entries for every heading past the watermark.
 *  - The LAST entry is intentionally left with `closedAt: null` — it
 *    represents the section currently being written, and is the natural
 *    "RESUME HERE" pointer for the post-compaction recap.
 *
 * This is a pure function — it does NOT mutate the input log. The caller
 * (in useSpecConversation* `flushStreamBuffer`) applies the actions via
 * the store.
 */
export interface AdvanceResult {
  /** How many headings have now been detected total. The caller stores this
   *  on per-project stream state so subsequent calls only emit *new* events. */
  nextWatermark: number;
  /** Index into the existing log's `entries` array of the entry that should
   *  be closed (its `closedAt` flipped from null), plus the bytes-up-to
   *  the new heading. Empty when nothing to close. */
  toClose: Array<{ idx: number; closedAt: string; bytes: number }>;
  /** New entries to append, in document order. */
  toAppend: SpecCreationEntry[];
}

export function advanceCreationLog(
  buffer: string,
  log: SpecCreationLog,
  previousWatermark: number,
  now: () => string = () => new Date().toISOString(),
): AdvanceResult {
  const headings = parseHeadingsForLog(buffer);
  if (headings.length <= previousWatermark) {
    return { nextWatermark: previousWatermark, toClose: [], toAppend: [] };
  }

  const toClose: AdvanceResult['toClose'] = [];
  const toAppend: SpecCreationEntry[] = [];
  const ts = now();

  // The most recent entry currently in the log (if any) might still be open.
  // Close it against the first NEW heading's byte offset so its body bytes
  // are recorded.
  const existingLastIdx = log.entries.length - 1;
  const existingLast = existingLastIdx >= 0 ? log.entries[existingLastIdx] : null;
  const firstNewHeading = headings[previousWatermark];

  if (existingLast && existingLast.closedAt === null && firstNewHeading) {
    const prevHeading = headings[previousWatermark - 1];
    const bodyBytes = prevHeading
      ? Math.max(0, firstNewHeading.byteOffset - prevHeading.byteOffset)
      : firstNewHeading.byteOffset;
    toClose.push({
      idx: existingLastIdx,
      closedAt: ts,
      bytes: bodyBytes,
    });
  }

  // Append entries for every heading past the watermark. When multiple new
  // headings arrive in one flush, each one (except the very last) is
  // immediately closed by the heading that follows it. Only the final
  // heading stays open — it's the natural "RESUME HERE" pointer.
  for (let i = previousWatermark; i < headings.length; i++) {
    const h = headings[i];
    const isFinal = i === headings.length - 1;
    let closedAt: string | null = null;
    let bytes = 0;
    if (!isFinal) {
      const nextH = headings[i + 1];
      closedAt = ts;
      bytes = Math.max(0, nextH.byteOffset - h.byteOffset);
    }
    toAppend.push({
      startedAt: ts,
      closedAt,
      level: h.level,
      title: h.title,
      bytes,
      postCompaction: log.compactedAt !== null,
    });
  }

  return {
    nextWatermark: headings.length,
    toClose,
    toAppend,
  };
}

/**
 * Close the final open entry when the stream terminates (turn_complete or
 * cancellation). Caller passes total buffer bytes; we compute body bytes by
 * subtracting the open entry's heading position. Returns null if there's
 * nothing to close.
 */
export function finalizeOpenEntry(
  buffer: string,
  log: SpecCreationLog,
  now: () => string = () => new Date().toISOString(),
): { idx: number; closedAt: string; bytes: number } | null {
  const lastEntryIdx = log.entries.length - 1;
  if (lastEntryIdx < 0) return null;
  const last = log.entries[lastEntryIdx];
  if (last.closedAt !== null) return null;
  const headings = parseHeadingsForLog(buffer);
  const finalHeading = headings[headings.length - 1];
  const bodyBytes = finalHeading
    ? Math.max(0, buffer.length - finalHeading.byteOffset)
    : buffer.length;
  return { idx: lastEntryIdx, closedAt: now(), bytes: bodyBytes };
}

/**
 * Format the log + compaction info into a recap block the next user prompt
 * can be prefixed with. The model reads this and uses it to skip already-
 * written sections, resume the in-progress one, and avoid duplicating
 * post-compaction work.
 */
export function renderCreationLogRecap(
  log: SpecCreationLog,
  compaction: CompactionRunInfo,
): string {
  if (log.entries.length === 0) return '';

  const lines: string[] = [
    '[SpecWriter creation log — context was compacted at ' +
      `${compaction.at}; below is the programmatic record of what you had ` +
      'already written before the compact. Use this to resume without ' +
      're-asking and to avoid re-emitting sections already covered.]',
    '',
  ];

  // Partition entries by phase.
  // - pre-compact = closed entries with postCompaction === false
  // - in-progress = the open entry (if any) — typically the one that was
  //   mid-write when compact hit (we mark it RESUME HERE)
  // - post-compact = entries with postCompaction === true
  const preClosed: SpecCreationEntry[] = [];
  const postClosed: SpecCreationEntry[] = [];
  let inProgress: SpecCreationEntry | null = null;

  for (const e of log.entries) {
    if (e.closedAt === null) {
      inProgress = e;
      continue;
    }
    if (e.postCompaction) postClosed.push(e);
    else preClosed.push(e);
  }

  if (preClosed.length > 0) {
    lines.push('Sections completed pre-compact:');
    for (const e of preClosed) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  if (inProgress) {
    lines.push('Last section in progress when compact hit (RESUME HERE):');
    lines.push(formatEntry(inProgress, true));
    lines.push('');
  }

  if (postClosed.length > 0) {
    lines.push('Sections written post-compact:');
    for (const e of postClosed) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  lines.push(
    'Do NOT rewrite completed sections. Continue from the in-progress section, or — if there is none — from where the last listed section left off.',
  );

  return lines.join('\n');
}

function formatEntry(e: SpecCreationEntry, isResume = false): string {
  const hashes = '#'.repeat(e.level);
  const bytesLabel = isResume
    ? `started ${e.startedAt}, ~${e.bytes.toLocaleString()} bytes written`
    : `H${e.level}, ${e.bytes.toLocaleString()} bytes`;
  return `- \`${hashes} ${e.title}\`  (${bytesLabel})`;
}
