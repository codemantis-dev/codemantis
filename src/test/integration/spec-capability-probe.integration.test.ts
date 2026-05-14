/**
 * Integration test: SpecWriter Phase 0 capability probe end-to-end.
 *
 * Verifies the full path from `loadContext` through probe → store → prompt
 * rendering: the probe runs, the record lands in `projectCapabilities`,
 * `writeProjectCapabilities` is invoked to persist it, and the SpecWriter
 * system prompt (built by `buildClaudeCodePrompt`) contains the rendered
 * `## Capabilities` section plus the AUTHORITY addendum that forbids
 * acceptance criteria referencing absent capabilities.
 *
 * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resetAllStores } from '../helpers/store-reset';
import { useSpecWriterStore } from '../../stores/specWriterStore';
import type { ProjectCapabilitiesRecord } from '../../types/spec-writer';

const PROJECT = '/tmp/probe-fixture';

const FAKE_RECORD: ProjectCapabilitiesRecord = {
  schemaVersion: 1,
  probedAt: '2026-05-14T12:00:00Z',
  probedByCliVersion: 'claude-code 2.1.126',
  probedBySpecWriterVersion: '1.1.10',
  stalenessWindow: 'PT24H',
  capabilities: [
    {
      id: 'browser-mcp',
      status: 'claimed-unverified',
      discoveredBy: 'passive-probe',
      evidence: "MCP server 'browsermcp' configured (scope: global)",
      lastVerifiedAt: '2026-05-14T12:00:00Z',
      verifyMethod: 'live-fire: mcp__browsermcp__browser_navigate about:blank',
      expires: null,
    },
    {
      id: 'test-runner.any',
      status: 'absent',
      discoveredBy: 'passive-probe',
      evidence: 'package.json: no vitest/jest/playwright/cypress in deps or devDeps',
      lastVerifiedAt: '2026-05-14T12:00:00Z',
      verifyMethod: null,
      expires: null,
      notes: 'Spec must substitute (e.g. browser-mcp) or DEFER behavioral checks.',
    },
    {
      id: 'typecheck.tsc-projectref',
      status: 'verified',
      discoveredBy: 'passive-probe',
      evidence:
        'tsconfig.json has empty `files` + project references → bare `tsc` is vacuous. Real cmd: tsc --noEmit -p tsconfig.app.json',
      lastVerifiedAt: '2026-05-14T12:00:00Z',
      verifyMethod: 'tsc --noEmit -p tsconfig.app.json',
      expires: null,
      notes:
        'Specs MUST reference this capability, not `typecheck.tsc-default`. Bare `tsc --noEmit` resolves to root tsconfig and does nothing.',
    },
  ],
};

// `vi.mock` is hoisted; module-level `const` declarations are in the TDZ when
// the factory runs. `vi.hoisted` guarantees the mock functions are constructed
// in the same hoisting pass, so the factory can reference them safely.
const { probeMock, writeMock } = vi.hoisted(() => ({
  probeMock: vi.fn(),
  writeMock: vi.fn(),
}));

vi.mock('../../lib/tauri-commands', () => ({
  // ── SpecWriter pipeline mocks ──
  createSpecwriterSession: vi.fn().mockResolvedValue('session-1'),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  interruptSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => undefined),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue('Project: probe-fixture'),
  readFileContent: vi.fn().mockResolvedValue({
    path: '',
    found: false,
    content: null,
    totalLines: 0,
    truncated: false,
  }),

  // ── Phase 0 capability probe (the unit under test) ──
  probeProjectCapabilities: probeMock,
  writeProjectCapabilities: writeMock,
  readProjectCapabilities: vi.fn().mockResolvedValue(null),
}));

import { useSpecConversationClaude } from '../../hooks/useSpecConversationClaude';
import { buildClaudeCodePrompt } from '../../lib/spec-prompts';

describe('SpecWriter Phase 0 capability probe integration', () => {
  beforeEach(() => {
    resetAllStores();
    probeMock.mockReset();
    writeMock.mockReset();
    probeMock.mockResolvedValue(FAKE_RECORD);
    writeMock.mockResolvedValue(undefined);
  });

  it('runs the probe during loadContext and stores the record', async () => {
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });

    expect(probeMock).toHaveBeenCalledWith(PROJECT);
    const stored = useSpecWriterStore.getState().projectCapabilities.get(PROJECT);
    expect(stored).toEqual(FAKE_RECORD);
  });

  it('persists the probed record via writeProjectCapabilities', async () => {
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    expect(writeMock).toHaveBeenCalledWith(PROJECT, FAKE_RECORD);
  });

  it('treats probe failure as non-fatal — project context still loads', async () => {
    // Override the default `mockResolvedValue` from beforeEach with an always-reject.
    probeMock.mockReset();
    probeMock.mockRejectedValue(new Error('probe explosion'));
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    const state = useSpecWriterStore.getState();
    // Context loaded despite probe failure
    expect(state.projectContext.get(PROJECT)).toBe('Project: probe-fixture');
    // But no capabilities record stored
    expect(state.projectCapabilities.get(PROJECT)).toBeUndefined();
    // Persistence write must NOT have been called for a failed probe
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('renders the ## Capabilities section into the system prompt', () => {
    const prompt = buildClaudeCodePrompt(
      'feature',
      '<TEMPLATES>',
      'Project: probe-fixture',
      FAKE_RECORD,
    );
    expect(prompt).toContain('## Capabilities (probed 2026-05-14T12:00:00Z)');
    expect(prompt).toContain('browser-mcp: ⚠️ claimed-unverified');
    expect(prompt).toContain('test-runner.any: ❌ absent');
    expect(prompt).toContain('typecheck.tsc-projectref: ✅ verified');
  });

  it('includes the AUTHORITY addendum forbidding absent-capability acceptance criteria', () => {
    const prompt = buildClaudeCodePrompt(
      'feature',
      '<TEMPLATES>',
      'Project: probe-fixture',
      FAKE_RECORD,
    );
    expect(prompt).toContain('AUTHORITY:');
    expect(prompt).toContain('`capability=<id>`');
    expect(prompt).toContain('status: absent');
    expect(prompt).toContain('DEFERRED: pending capability');
  });

  it('omits the Capabilities section when no record exists', () => {
    const prompt = buildClaudeCodePrompt(
      'feature',
      '<TEMPLATES>',
      'Project: probe-fixture',
      null,
    );
    expect(prompt).not.toContain('## Capabilities');
    expect(prompt).not.toContain('AUTHORITY:');
  });
});
