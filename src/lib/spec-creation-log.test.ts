import { describe, it, expect } from 'vitest';
import {
  parseHeadingsForLog,
  advanceCreationLog,
  finalizeOpenEntry,
  renderCreationLogRecap,
} from './spec-creation-log';
import type {
  CompactionRunInfo,
  SpecCreationEntry,
  SpecCreationLog,
} from '../types/spec-writer';

const FIXED_NOW = () => '2026-05-12T12:00:00.000Z';

function emptyLog(): SpecCreationLog {
  return { entries: [], compactedAt: null };
}

describe('parseHeadingsForLog', () => {
  it('detects H1, H2 and H3 headings on fully-arrived lines only', () => {
    const buf = [
      '# Title',
      '',
      '## §1 Overview',
      '',
      'paragraph body',
      '',
      '### §1.1 Sub',
      // last line is partial — no trailing newline
      '## §2 Partial',
    ].join('\n');
    const headings = parseHeadingsForLog(buf);
    expect(headings.map((h) => h.title)).toEqual([
      'Title',
      '§1 Overview',
      '§1.1 Sub',
    ]);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
  });

  it('skips headings inside fenced code blocks', () => {
    const buf = [
      '# Real',
      '',
      '```',
      '# Not a heading',
      '## Also not',
      '```',
      '',
      '## Also real',
      '',
    ].join('\n');
    const headings = parseHeadingsForLog(buf);
    expect(headings.map((h) => h.title)).toEqual(['Real', 'Also real']);
  });

  it('records byte offsets in document order', () => {
    const buf = '# A\n\n## B\n\nbody\n';
    const headings = parseHeadingsForLog(buf);
    expect(headings).toHaveLength(2);
    expect(headings[0].byteOffset).toBe(0);
    expect(headings[1].byteOffset).toBeGreaterThan(headings[0].byteOffset);
    expect(buf.slice(headings[1].byteOffset).startsWith('## B')).toBe(true);
  });
});

describe('advanceCreationLog', () => {
  it('returns nothing when no new headings have arrived', () => {
    const log: SpecCreationLog = {
      entries: [
        {
          startedAt: 't0',
          closedAt: null,
          level: 1,
          title: 'Title',
          bytes: 0,
          postCompaction: false,
        },
      ],
      compactedAt: null,
    };
    const result = advanceCreationLog('# Title\n\nbody so far', log, 1, FIXED_NOW);
    expect(result.toClose).toEqual([]);
    expect(result.toAppend).toEqual([]);
    expect(result.nextWatermark).toBe(1);
  });

  it('appends a single entry on the first heading detection', () => {
    const result = advanceCreationLog('# Title\n', emptyLog(), 0, FIXED_NOW);
    expect(result.toAppend).toHaveLength(1);
    expect(result.toAppend[0].title).toBe('Title');
    expect(result.toAppend[0].closedAt).toBeNull();
    expect(result.toClose).toEqual([]);
    expect(result.nextWatermark).toBe(1);
  });

  it('closes the prior open entry when a new heading arrives', () => {
    const log: SpecCreationLog = {
      entries: [
        {
          startedAt: 't0',
          closedAt: null,
          level: 1,
          title: 'Title',
          bytes: 0,
          postCompaction: false,
        },
      ],
      compactedAt: null,
    };
    const buf = '# Title\n\nbody paragraph\n\n## §1 Overview\n';
    const result = advanceCreationLog(buf, log, 1, FIXED_NOW);
    expect(result.toClose).toHaveLength(1);
    expect(result.toClose[0].idx).toBe(0);
    expect(result.toClose[0].bytes).toBeGreaterThan(0);
    expect(result.toAppend).toHaveLength(1);
    expect(result.toAppend[0].title).toBe('§1 Overview');
    expect(result.toAppend[0].postCompaction).toBe(false);
  });

  it('flags new entries with postCompaction=true once compactedAt is set', () => {
    const log: SpecCreationLog = {
      entries: [],
      compactedAt: '2026-05-12T11:55:00.000Z',
    };
    const result = advanceCreationLog('# A\n## B\n', log, 0, FIXED_NOW);
    expect(result.toAppend).toHaveLength(2);
    expect(result.toAppend.every((e) => e.postCompaction)).toBe(true);
  });

  it('handles a heading that streams in across chunks (no newline yet → no detection)', () => {
    // Chunk 1: heading line is still partial — must NOT be detected.
    const chunk1 = '# Partia';
    const r1 = advanceCreationLog(chunk1, emptyLog(), 0, FIXED_NOW);
    expect(r1.toAppend).toEqual([]);
    expect(r1.nextWatermark).toBe(0);

    // Chunk 2: the rest of the line + newline arrives.
    const chunk2 = '# Partial\n';
    const r2 = advanceCreationLog(chunk2, emptyLog(), 0, FIXED_NOW);
    expect(r2.toAppend).toHaveLength(1);
    expect(r2.toAppend[0].title).toBe('Partial');
  });

  it('keeps only the LATEST entry open when multiple headings arrive in one flush', () => {
    // RESUME HERE applies to the final heading only — earlier ones in the
    // same batch are bounded by the heading that follows them, so they
    // close immediately with their body bytes.
    const buf = '# A\n## B\n### C\n';
    const r = advanceCreationLog(buf, emptyLog(), 0, FIXED_NOW);
    expect(r.toAppend).toHaveLength(3);
    expect(r.toAppend[0].closedAt).not.toBeNull();
    expect(r.toAppend[1].closedAt).not.toBeNull();
    expect(r.toAppend[2].closedAt).toBeNull();
    // Earlier-batch entries record positive body bytes.
    expect(r.toAppend[0].bytes).toBeGreaterThan(0);
    expect(r.toAppend[1].bytes).toBeGreaterThan(0);
  });
});

describe('finalizeOpenEntry', () => {
  it('closes the final open entry with body bytes equal to buffer-tail', () => {
    const log: SpecCreationLog = {
      entries: [
        {
          startedAt: 't0',
          closedAt: null,
          level: 2,
          title: 'last',
          bytes: 0,
          postCompaction: false,
        },
      ],
      compactedAt: null,
    };
    const buf = '## last\n\nbody\n';
    const result = finalizeOpenEntry(buf, log, FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.idx).toBe(0);
    expect(result!.bytes).toBeGreaterThan(0);
  });

  it('returns null when there is nothing to close', () => {
    expect(finalizeOpenEntry('# A\n', emptyLog(), FIXED_NOW)).toBeNull();

    const closedLog: SpecCreationLog = {
      entries: [
        {
          startedAt: 't0',
          closedAt: 't1',
          level: 1,
          title: 'A',
          bytes: 10,
          postCompaction: false,
        },
      ],
      compactedAt: null,
    };
    expect(finalizeOpenEntry('# A\n', closedLog, FIXED_NOW)).toBeNull();
  });
});

describe('renderCreationLogRecap', () => {
  const compaction: CompactionRunInfo = {
    trigger: 'auto',
    preTokens: 186_000,
    at: '2026-05-12T11:55:00.000Z',
  };

  it('returns an empty string when the log has no entries', () => {
    expect(renderCreationLogRecap(emptyLog(), compaction)).toBe('');
  });

  it('partitions entries into pre-compact, in-progress, post-compact', () => {
    const entries: SpecCreationEntry[] = [
      { startedAt: 't0', closedAt: 't1', level: 1, title: 'Title', bytes: 412, postCompaction: false },
      { startedAt: 't1', closedAt: 't2', level: 2, title: '§1 Overview', bytes: 1204, postCompaction: false },
      // open at compaction time — the RESUME HERE entry
      { startedAt: 't2', closedAt: null, level: 3, title: 'Session 2: Auth scaffolding', bytes: 1820, postCompaction: false },
      // post-compact closed
      { startedAt: 't3', closedAt: 't4', level: 3, title: 'Session 3: API surface', bytes: 980, postCompaction: true },
    ];
    const recap = renderCreationLogRecap(
      { entries, compactedAt: compaction.at },
      compaction,
    );
    expect(recap).toContain('Sections completed pre-compact');
    expect(recap).toContain('# Title');
    expect(recap).toContain('§1 Overview');
    expect(recap).toContain('RESUME HERE');
    expect(recap).toContain('Session 2: Auth scaffolding');
    expect(recap).toContain('Sections written post-compact');
    expect(recap).toContain('Session 3: API surface');
    expect(recap).toContain('Do NOT rewrite completed sections');
  });

  it('omits the in-progress block when every entry is closed', () => {
    const recap = renderCreationLogRecap(
      {
        entries: [
          { startedAt: 't0', closedAt: 't1', level: 1, title: 'A', bytes: 10, postCompaction: false },
          { startedAt: 't1', closedAt: 't2', level: 2, title: 'B', bytes: 20, postCompaction: true },
        ],
        compactedAt: compaction.at,
      },
      compaction,
    );
    expect(recap).toContain('Sections completed pre-compact');
    expect(recap).toContain('Sections written post-compact');
    expect(recap).not.toContain('RESUME HERE');
  });
});
