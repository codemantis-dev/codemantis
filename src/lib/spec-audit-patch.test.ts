import { describe, it, expect } from 'vitest';
import { parseAuditPatch, applyAuditPatch, summarizePatchApplication } from './spec-audit-patch';

const BASE_SPEC = [
  '# Project — Specification',
  '',
  '## §1 Overview',
  '',
  'Original overview content with enough body to clear the byte-ratio gate when',
  'we replace one section. Keep this paragraph intact across edits so we can',
  'verify non-targeted sections survive.',
  '',
  '## §2 Architecture',
  '',
  'Original architecture content. Lorem ipsum dolor sit amet, consectetur',
  'adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna',
  'aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.',
  '',
  '### §2.1 Components',
  '',
  'Original components subsection. Sufficient text to make the section non-trivial',
  'and ensure the size-collapse gate has headroom across edits.',
  '',
  '## §3 Data Model',
  '',
  '```python',
  '_STAGE_REGISTRY = {',
  '    "old_stage": OldStage,',
  '}',
  '```',
  '',
  '## §4 Conclusion',
  '',
  'Wrap-up content for §4 with enough length to keep things stable.',
  '',
].join('\n');

describe('parseAuditPatch', () => {
  it('returns no-marker warning when AUDIT-PATCH marker is absent', () => {
    const r = parseAuditPatch('No marker here, just prose.');
    expect(r.ops).toHaveLength(0);
    expect(r.warnings.some((w) => w.startsWith('no-marker'))).toBe(true);
  });

  it('parses a single replace-section op', () => {
    const text = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:replace-section heading="§2 Architecture" -->',
      '## §2 Architecture',
      '',
      'New content.',
      '<!-- /patch -->',
    ].join('\n');
    const r = parseAuditPatch(text);
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ kind: 'replace-section', heading: '§2 Architecture' });
    expect(r.ops[0].body).toContain('New content.');
  });

  it('parses multiple ops in order', () => {
    const text = [
      '<!-- AUDIT-PATCH -->',
      'Some narration the model leaks.',
      '<!-- patch:replace-section heading="§2" -->',
      '## §2 Architecture (revised)',
      '<!-- /patch -->',
      'More narration.',
      '<!-- patch:append-section -->',
      '## §5 New Trailing Section',
      'Body.',
      '<!-- /patch -->',
    ].join('\n');
    const r = parseAuditPatch(text);
    expect(r.ops.map((o) => o.kind)).toEqual(['replace-section', 'append-section']);
    expect(r.warnings.some((w) => w.startsWith('narration-dropped'))).toBe(true);
  });

  it('flags unbalanced open block', () => {
    const text = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:replace-section heading="§1 Overview" -->',
      'no close',
    ].join('\n');
    const r = parseAuditPatch(text);
    expect(r.ops).toHaveLength(0);
    expect(r.warnings.some((w) => w.startsWith('unbalanced'))).toBe(true);
  });

  it('flags nested patch opens', () => {
    const text = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:replace-section heading="§1" -->',
      '<!-- patch:replace-section heading="§2" -->',
      '## inner',
      '<!-- /patch -->',
      '<!-- /patch -->',
    ].join('\n');
    const r = parseAuditPatch(text);
    expect(r.warnings.some((w) => w.startsWith('nested'))).toBe(true);
  });

  it('flags missing heading attribute on replace-section', () => {
    const text = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:replace-section -->',
      'body',
      '<!-- /patch -->',
    ].join('\n');
    const r = parseAuditPatch(text);
    expect(r.ops).toHaveLength(0);
    expect(r.warnings.some((w) => w.startsWith('missing-heading'))).toBe(true);
  });

  it('append-section does not require heading', () => {
    const text = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:append-section -->',
      '## §99 Tail',
      'tail body',
      '<!-- /patch -->',
    ].join('\n');
    const r = parseAuditPatch(text);
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0].kind).toBe('append-section');
    expect(r.ops[0].heading).toBeUndefined();
  });
});

describe('applyAuditPatch', () => {
  it('replaces a single H2 section without touching its siblings', () => {
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§2 Architecture',
        body: [
          '## §2 Architecture',
          '',
          'Replacement architecture content. New paragraph that is at least as long',
          'as the original to avoid tripping the size-collapse gate.',
          '',
          '### §2.1 Components',
          '',
          'Replacement components subsection retained so the heading inventory is',
          'preserved across the merge.',
        ].join('\n'),
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.errors).toEqual([]);
    expect(result.merged).not.toBeNull();
    expect(result.merged).toContain('# Project — Specification');
    expect(result.merged).toContain('Replacement architecture content');
    expect(result.merged).not.toContain('Original architecture content');
    expect(result.merged).toContain('Original overview content'); // §1 untouched
    expect(result.merged).toContain('_STAGE_REGISTRY = {'); // §3 untouched
    expect(result.merged).toContain('Wrap-up content for §4'); // §4 untouched
    expect(result.appliedOps).toEqual(['replace-section']);
  });

  it('insert-after splices a new section after the anchor', () => {
    const ops = [
      {
        kind: 'insert-after' as const,
        heading: '§2 Architecture',
        body: ['## §2.5 New Section', '', 'New content body to insert.'].join('\n'),
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.errors).toEqual([]);
    expect(result.merged).not.toBeNull();
    const merged = result.merged!;
    const idxArch = merged.indexOf('## §2 Architecture');
    const idxNew = merged.indexOf('## §2.5 New Section');
    const idxData = merged.indexOf('## §3 Data Model');
    expect(idxArch).toBeGreaterThan(0);
    expect(idxNew).toBeGreaterThan(idxArch);
    expect(idxData).toBeGreaterThan(idxNew);
  });

  it('append-section appends at the end of the doc', () => {
    const ops = [
      {
        kind: 'append-section' as const,
        body: ['## §99 Tail', '', 'Trailing content.'].join('\n'),
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.errors).toEqual([]);
    expect(result.merged).not.toBeNull();
    expect(result.merged!.indexOf('## §4 Conclusion')).toBeLessThan(
      result.merged!.indexOf('## §99 Tail'),
    );
  });

  it('rejects merge when heading is not found', () => {
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§42 Unicorn',
        body: '## §42 Unicorn\n\nDoes not exist.',
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('replace-section: heading'))).toBe(true);
    expect(result.appliedOps).toEqual([]);
  });

  it('matches headings tolerantly (numeric prefix variants)', () => {
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '2 Architecture', // no §
        body: [
          '## §2 Architecture',
          '',
          'Replacement architecture content with enough body to keep size stable',
          'and the heading inventory intact.',
          '',
          '### §2.1 Components',
          '',
          'Components retained.',
        ].join('\n'),
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.errors).toEqual([]);
    expect(result.merged).toContain('Replacement architecture content');
  });

  it('rejects merge that alters the H1 title via a replace-section targeting H1', () => {
    // H1 is itself a section (level 1). Targeting it with replace-section that
    // emits a different H1 must trip the h1-changed gate.
    const longBody = 'Section one body. '.repeat(60);
    const spec =
      `# Project — Specification\n\n## §1 Overview\n\n${longBody}\n\n## §2 Detail\n\n${longBody}\n`;
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: 'Project — Specification',
        body: `# Project — DIFFERENT TITLE\n\nIntro body. ${'pad '.repeat(40)}`,
      },
    ];
    const result = applyAuditPatch(spec, ops);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('h1-changed'))).toBe(true);
  });

  it('rejects merge that collapses below 60% of original size', () => {
    const big = '# Big — Specification\n\n## §1 X\n\n' + 'body. '.repeat(500) + '\n';
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§1 X',
        body: '## §1 X\n\ntiny.',
      },
    ];
    const result = applyAuditPatch(big, ops);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('size-collapse'))).toBe(true);
  });

  it('rejects merge that drops a non-targeted heading', () => {
    // Construct an op whose replacement body for §2 omits the §2.1 sub-heading.
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§2 Architecture',
        body: [
          '## §2 Architecture',
          '',
          'Replacement architecture content. Lorem ipsum dolor sit amet,',
          'consectetur adipiscing elit, sed do eiusmod tempor incididunt ut',
          'labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud.',
          '',
          // Deliberately omit "### §2.1 Components" — heading-lost gate must fire.
        ].join('\n'),
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('heading-lost'))).toBe(true);
  });

  it('rejects mixed valid + invalid ops without partial application', () => {
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§2 Architecture',
        body: '## §2 Architecture\n\nfine.',
      },
      {
        kind: 'replace-section' as const,
        heading: '§99 Nope',
        body: 'whatever',
      },
    ];
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.merged).toBeNull();
    expect(result.appliedOps).toEqual([]); // no partial application
  });

  it('rejects empty original spec', () => {
    const result = applyAuditPatch('', [
      { kind: 'append-section', body: '## X\n\nbody' },
    ]);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('original-spec-empty'))).toBe(true);
  });

  it('rejects empty op list', () => {
    const result = applyAuditPatch(BASE_SPEC, []);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('no-ops'))).toBe(true);
  });

  it('detects overlapping replace-sections', () => {
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§2 Architecture',
        body: '## §2 Architecture\n\n' + 'replacement content. '.repeat(20),
      },
      {
        kind: 'replace-section' as const,
        heading: '§2.1 Components',
        body: '### §2.1 Components\n\n' + 'sub replacement. '.repeat(20),
      },
    ];
    // §2.1 lives INSIDE §2's range, so a full §2 replace and a §2.1 replace overlap.
    const result = applyAuditPatch(BASE_SPEC, ops);
    expect(result.merged).toBeNull();
    expect(result.errors.some((e) => e.startsWith('overlap'))).toBe(true);
  });

  it('walker is fence-aware (does not treat headings inside code blocks as sections)', () => {
    const spec = [
      '# Project — Specification',
      '',
      '## §1 Overview',
      '',
      '```',
      '## fake heading inside fence',
      '```',
      '',
      'real overview content with substance to keep things sane.',
      '',
      '## §2 Real Section',
      '',
      'body content body content body content body content.',
      '',
    ].join('\n');
    const ops = [
      {
        kind: 'replace-section' as const,
        heading: '§2 Real Section',
        body: '## §2 Real Section\n\n' + 'replacement body content. '.repeat(8),
      },
    ];
    const result = applyAuditPatch(spec, ops);
    expect(result.errors).toEqual([]);
    expect(result.merged).toContain('## fake heading inside fence'); // still inside fence
    expect(result.merged).toContain('replacement body content');
  });
});

describe('summarizePatchApplication', () => {
  it('formats success summary', () => {
    const summary = summarizePatchApplication({
      merged: 'merged',
      warnings: [],
      errors: [],
      appliedOps: ['replace-section', 'replace-section', 'append-section'],
    });
    expect(summary).toContain('Coverage repair applied');
    expect(summary).toContain('2× replace-section');
    expect(summary).toContain('1× append-section');
  });

  it('formats failure summary with reasons', () => {
    const summary = summarizePatchApplication({
      merged: null,
      warnings: [],
      errors: ['heading-lost: ...', 'size-collapse: ...'],
      appliedOps: [],
    });
    expect(summary).toContain('could not be applied');
    expect(summary).toContain('heading-lost');
    expect(summary).toContain('size-collapse');
  });
});

// ─── Multi-sibling H3 replacement — locks in the splitter contract that
// the session-size recheck prompt depends on. If this test breaks the
// "Patch spec & re-audit" flow for oversized sessions silently fails. ───

describe('replace-section H3 with multi-sibling body (session splitter)', () => {
  const SESSION_SPEC = [
    '# Project — Specification',
    '',
    '## §1 Overview',
    '',
    'Project overview paragraph kept long enough that the byte-ratio gate has',
    'headroom on any single-section replacement that follows.',
    '',
    '## §10 Session Plan',
    '',
    '> ⚠️ This specification is too large for a single Claude Code session.',
    '',
    '### Session 1: Foundation',
    '',
    '**Scope:** Database schema and auth scaffold.',
    '**Files:**',
    '- `migrations/001.sql` (create)',
    '**User-visible outcome:** (foundation)',
    '**Foundation justification:** No routes reachable yet — pure schema setup.',
    '',
    '### Session 2: Sprawling work',
    '',
    '**Scope:** This session originally bundles too much work across surfaces.',
    '**Files:**',
    '- `worker/foo.py` (modify)',
    '- `supabase/functions/bar/index.ts` (create)',
    '- `src/components/Baz.tsx` (create)',
    '**User-visible outcome:** user can do everything at once.',
    '',
    '### Session 3: Polish',
    '',
    '**Scope:** Final UI polish pass on the dashboard.',
    '**Files:**',
    '- `src/components/Dashboard.tsx` (modify)',
    '**User-visible outcome:** dashboard looks finished.',
    '',
    '## §11 Conclusion',
    '',
    'Closing paragraph kept long enough that the size-collapse gate has',
    'headroom regardless of which session block above is split.',
    '',
  ].join('\n');

  it('replaces Session 2 with two sibling H3 sub-sessions while leaving Session 3 intact', () => {
    const replacement = [
      '### Session 2a: Worker bits',
      '',
      '**Scope:** Worker-only changes split out of the original Session 2.',
      '**Files:**',
      '- `worker/foo.py` (modify)',
      '**User-visible outcome:** worker processes new event kind.',
      '',
      '### Session 2b: Frontend + edge fn',
      '',
      '**Scope:** Frontend + edge-function changes split out of the original Session 2.',
      '**Files:**',
      '- `supabase/functions/bar/index.ts` (create)',
      '- `src/components/Baz.tsx` (create)',
      '**User-visible outcome:** user sees the new Baz component fetch from bar.',
      '',
    ].join('\n');

    const result = applyAuditPatch(SESSION_SPEC, [
      {
        kind: 'replace-section' as const,
        heading: '### Session 2: Sprawling work',
        body: replacement,
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.merged).not.toBeNull();
    const merged = result.merged!;

    // The original H3 is gone, both new siblings are present.
    expect(merged).not.toContain('### Session 2: Sprawling work');
    expect(merged).toContain('### Session 2a: Worker bits');
    expect(merged).toContain('### Session 2b: Frontend + edge fn');

    // Session 1 and Session 3 survive untouched — heading-inventory gate
    // requires this and so does the user expectation that "we never
    // renumber later sessions when splitting".
    expect(merged).toContain('### Session 1: Foundation');
    expect(merged).toContain('### Session 3: Polish');
    expect(merged).toContain('dashboard looks finished');

    // Order: 1 < 2a < 2b < 3.
    const idx1 = merged.indexOf('### Session 1: Foundation');
    const idx2a = merged.indexOf('### Session 2a:');
    const idx2b = merged.indexOf('### Session 2b:');
    const idx3 = merged.indexOf('### Session 3: Polish');
    expect(idx1).toBeGreaterThan(0);
    expect(idx2a).toBeGreaterThan(idx1);
    expect(idx2b).toBeGreaterThan(idx2a);
    expect(idx3).toBeGreaterThan(idx2b);

    expect(result.appliedOps).toEqual(['replace-section']);
  });

  it('rejects a session-splitter patch that omits the original H3 inventory entry without replacement', () => {
    // If the model emits a body that doesn't include the original heading
    // OR any sibling H3s with `Session 2` lineage, the inventory gate
    // wouldn't fire (we only require the *replaced* heading to be allowed
    // missing), but the splice should still preserve Session 3.
    const replacement = [
      '### Session 2a: Worker',
      '',
      'Replacement body keeping just one sub-session — Session 3 must still survive.',
      '',
    ].join('\n');

    const result = applyAuditPatch(SESSION_SPEC, [
      {
        kind: 'replace-section' as const,
        heading: '### Session 2: Sprawling work',
        body: replacement,
      },
    ]);

    expect(result.errors).toEqual([]);
    const merged = result.merged!;
    expect(merged).toContain('### Session 2a: Worker');
    expect(merged).toContain('### Session 3: Polish');
    expect(merged).not.toContain('Sprawling work');
  });
});
