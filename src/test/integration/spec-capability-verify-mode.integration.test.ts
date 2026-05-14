/**
 * Integration test: PR 3 verify-mode capability awareness end-to-end.
 *
 * Verifies that capability records stored by SpecWriter (PR 1/2) flow into
 * the Self-Drive orchestrator's user message exactly as the orchestrator
 * needs them to grade verify items: items tagged `[kind capability=X]`
 * resolve to skipped when X is absent, browser-action evidence is
 * recognized when capability=browser-mcp is verified, and the system-prompt
 * rule that drives this is present.
 *
 * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetAllStores } from '../helpers/store-reset';
import { useSpecWriterStore } from '../../stores/specWriterStore';
import { parseEvidence } from '../../lib/self-drive-evidence-parser';
import { shouldAutoResolveToNA, findMissingCapabilityRefs } from '../../lib/capability-gating';
import { recoveryBodyForKind } from '../../lib/recovery-prompt';
import { VERIFY_MODE_PREAMBLE } from '../../lib/guide-verify-prompt';
import type { ProjectCapabilitiesRecord } from '../../types/spec-writer';

const PROJECT = '/tmp/verify-mode-fixture';

const RECORD: ProjectCapabilitiesRecord = {
  schemaVersion: 1,
  probedAt: '2026-05-15T10:00:00Z',
  probedByCliVersion: 'claude-code 2.1.126',
  probedBySpecWriterVersion: '1.1.10',
  stalenessWindow: 'PT24H',
  capabilities: [
    {
      id: 'browser-mcp',
      status: 'verified',
      discoveredBy: 'live-fire',
      evidence: 'navigate+snapshot → 200',
      lastVerifiedAt: '2026-05-15T10:00:00Z',
      verifyMethod: 'browser_navigate about:blank',
      expires: null,
    },
    {
      id: 'test-runner.any',
      status: 'absent',
      discoveredBy: 'passive-probe',
      evidence: 'package.json has no vitest/jest/playwright',
      lastVerifiedAt: '2026-05-15T10:00:00Z',
      verifyMethod: null,
      expires: null,
    },
    {
      id: 'db.supabase-service-role',
      status: 'verified',
      discoveredBy: 'live-fire',
      evidence: 'REST /rest/v1/ → 200 with service-role',
      lastVerifiedAt: '2026-05-15T10:00:00Z',
      verifyMethod: 'GET /rest/v1/',
      expires: null,
    },
  ],
};

describe('PR3 verify-mode capability awareness', () => {
  beforeEach(() => {
    resetAllStores();
    useSpecWriterStore.getState().setProjectCapabilities(PROJECT, RECORD);
  });

  it('items tagged with an absent capability auto-resolve to N/A', () => {
    const decision = shouldAutoResolveToNA(
      '[behavioral capability=test-runner.any] vitest passes for FooComponent',
      RECORD,
    );
    expect(decision.autoNA).toBe(true);
    expect(decision.capabilityId).toBe('test-runner.any');
    expect(decision.reason).toContain('absent at spec-write time');
  });

  it('items tagged with a verified capability stay gradeable', () => {
    const decision = shouldAutoResolveToNA(
      '[behavioral capability=browser-mcp] Klick ort-field',
      RECORD,
    );
    expect(decision.autoNA).toBe(false);
    expect(decision.capabilityId).toBe('browser-mcp');
  });

  it('finds capability references that are missing from the record (triggers re-probe)', () => {
    const missing = findMissingCapabilityRefs(
      [
        '[behavioral capability=browser-mcp] x',
        '[behavioral capability=llm-key.gemini] uses gemini', // not in record
        '[integration capability=db.supabase-service-role] write',
      ],
      RECORD,
    );
    expect(missing).toEqual(['llm-key.gemini']);
  });

  it('parses a browser-action sequence as PASS with mocks=none', () => {
    // VerifyCheck labels are stored without the `[kind]` prefix — kind is a
    // separate field on the VerifyCheck object. The `capability=` reference
    // is what the orchestrator gates on; the parser sees only the label text.
    const verifierResponse = [
      '1. Klick ort-field renders text input — PASS —',
      '   $ browser_navigate http://localhost:5173/crm-companies/abc → snapshot ok',
      '   $ browser_click [data-testid=ort-field] → focus active',
      '   $ browser_type "Linz" + Enter → snapshot shows "Linz"',
      '   $ browser_snapshot → DOM contains "Linz"',
    ].join('\n');

    const out = parseEvidence(verifierResponse, [
      'Klick ort-field renders text input',
    ]);
    expect(out[0].verdict).toBe('PASS');
    expect(out[0].browserActionCalls.sort()).toEqual(
      ['browser_click', 'browser_navigate', 'browser_snapshot', 'browser_type'].sort(),
    );
    expect(out[0].mocks).toEqual(['none']);
  });

  it('VERIFY_MODE_PREAMBLE documents browser-action and capability tags', () => {
    expect(VERIFY_MODE_PREAMBLE).toContain('CAPABILITY TAGS');
    expect(VERIFY_MODE_PREAMBLE).toContain('capability=browser-mcp');
    expect(VERIFY_MODE_PREAMBLE).toContain('BROWSER-ACTION SHAPE');
    expect(VERIFY_MODE_PREAMBLE).toMatch(/browser_navigate.*browser_click.*browser_type.*browser_snapshot/s);
  });

  it('recoveryBodyForKind capability-missing offers substitution + DEFER escape hatches', () => {
    const body = recoveryBodyForKind('capability-missing');
    expect(body).toContain('project-capabilities.json');
    expect(body).toMatch(/browser-mcp|substitute|DEFER/);
    expect(body).toContain('NOT-RESOLVED');
  });
});
