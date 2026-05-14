/**
 * Integration test: SpecWriter Phase 0b capability handshake end-to-end.
 *
 * Verifies the handshake orchestration:
 *  1. After `loadContext` runs the probe, `pendingHandshakeQuestions` is
 *     populated when the setting is ON and claimed-unverified items exist.
 *  2. With the setting OFF, no handshake is queued.
 *  3. `applyHandshakeAnswers` dispatches live-fire for "verify" answers,
 *     marks "absent" choices explicitly, and merges results into the record.
 *  4. The persisted record is written via `writeProjectCapabilities`.
 *  5. The pending-questions map is cleared after resolution.
 *
 * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resetAllStores } from '../helpers/store-reset';
import { useSpecWriterStore } from '../../stores/specWriterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type {
  ProbedCapability,
  ProjectCapabilitiesRecord,
} from '../../types/spec-writer';

const PROJECT = '/tmp/handshake-fixture';

function cap(
  id: string,
  status: ProbedCapability['status'] = 'claimed-unverified',
): ProbedCapability {
  return {
    id,
    status,
    discoveredBy: 'passive-probe',
    evidence: `fixture evidence for ${id}`,
    lastVerifiedAt: '2026-05-14T12:00:00Z',
    verifyMethod: 'fixture-verify',
    expires: null,
  };
}

const FAKE_RECORD: ProjectCapabilitiesRecord = {
  schemaVersion: 1,
  probedAt: '2026-05-14T12:00:00Z',
  probedByCliVersion: null,
  probedBySpecWriterVersion: '1.1.10',
  stalenessWindow: 'PT24H',
  capabilities: [
    cap('browser-mcp'),
    cap('llm-key.openai'),
    cap('test-runner.vitest', 'verified'),
  ],
};

const { probeMock, writeMock, fireMock } = vi.hoisted(() => ({
  probeMock: vi.fn(),
  writeMock: vi.fn(),
  fireMock: vi.fn(),
}));

vi.mock('../../lib/tauri-commands', () => ({
  createSpecwriterSession: vi.fn().mockResolvedValue('session-1'),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  interruptSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => undefined),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue('Project: handshake-fixture'),
  readFileContent: vi.fn().mockResolvedValue({
    path: '',
    found: false,
    content: null,
    totalLines: 0,
    truncated: false,
  }),
  probeProjectCapabilities: probeMock,
  writeProjectCapabilities: writeMock,
  liveFireCapabilities: fireMock,
  readProjectCapabilities: vi.fn().mockResolvedValue(null),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
}));

import { useSpecConversationClaude } from '../../hooks/useSpecConversationClaude';

function setConfirmEnabled(enabled: boolean): void {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      selfDriveConfirmCapabilities: enabled,
    },
    loaded: true,
  });
}

describe('SpecWriter Phase 0b capability handshake integration', () => {
  beforeEach(() => {
    resetAllStores();
    probeMock.mockReset();
    writeMock.mockReset();
    fireMock.mockReset();
    probeMock.mockResolvedValue(FAKE_RECORD);
    writeMock.mockResolvedValue(undefined);
    fireMock.mockResolvedValue([]);
  });

  it('populates pendingHandshakeQuestions when setting is ON and items need confirmation', async () => {
    setConfirmEnabled(true);
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    const questions = useSpecWriterStore.getState().pendingHandshakeQuestions.get(PROJECT);
    expect(questions).toBeDefined();
    expect(questions!.map((q) => q.capabilityId)).toEqual(['browser-mcp', 'llm-key.openai']);
  });

  it('skips the handshake when setting is OFF', async () => {
    setConfirmEnabled(false);
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    const questions = useSpecWriterStore.getState().pendingHandshakeQuestions.get(PROJECT);
    expect(questions).toBeUndefined();
  });

  it('skips the handshake when nothing is claimed-unverified', async () => {
    setConfirmEnabled(true);
    probeMock.mockResolvedValueOnce({
      ...FAKE_RECORD,
      capabilities: [
        cap('browser-mcp', 'verified'),
        cap('test-runner.vitest', 'verified'),
      ],
    });
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    const questions = useSpecWriterStore.getState().pendingHandshakeQuestions.get(PROJECT);
    // No claimed-unverified items → no handshake.
    expect(questions).toBeUndefined();
  });

  it('applyHandshakeAnswers dispatches live-fire for verify picks and merges results', async () => {
    setConfirmEnabled(true);
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    // Fake the live-fire result: openai verified, browser-mcp comes back as
    // claimed-unverified (frontend-handles-later marker).
    fireMock.mockResolvedValueOnce([
      {
        id: 'llm-key.openai',
        status: 'verified',
        discoveredBy: 'live-fire',
        evidence: 'GET /v1/models → 200',
        lastVerifiedAt: '2026-05-14T13:00:00Z',
        verifyMethod: 'GET https://api.openai.com/v1/models',
        expires: null,
      },
    ]);

    await act(async () => {
      await useSpecWriterStore.getState().applyHandshakeAnswers(PROJECT, [
        { capabilityId: 'browser-mcp', action: 'absent' },
        { capabilityId: 'llm-key.openai', action: 'verify' },
      ]);
    });

    expect(fireMock).toHaveBeenCalledWith(PROJECT, ['llm-key.openai']);

    const record = useSpecWriterStore.getState().projectCapabilities.get(PROJECT)!;
    const browser = record.capabilities.find((c) => c.id === 'browser-mcp')!;
    const openai = record.capabilities.find((c) => c.id === 'llm-key.openai')!;

    expect(browser.status).toBe('absent');
    expect(browser.discoveredBy).toBe('user-handshake');
    expect(openai.status).toBe('verified');
    expect(openai.discoveredBy).toBe('live-fire');

    // Verified items in the original record stay untouched.
    const vitest = record.capabilities.find((c) => c.id === 'test-runner.vitest')!;
    expect(vitest.status).toBe('verified');

    // The persisted record reflects the merged result, and the handshake
    // queue is now empty.
    expect(writeMock).toHaveBeenLastCalledWith(PROJECT, record);
    expect(useSpecWriterStore.getState().pendingHandshakeQuestions.get(PROJECT)).toBeUndefined();
  });

  it('treats live-fire IPC failure as per-capability absent (still clears handshake)', async () => {
    setConfirmEnabled(true);
    const { result } = renderHook(() => useSpecConversationClaude());
    await act(async () => {
      await result.current.loadContext(PROJECT);
    });
    fireMock.mockRejectedValueOnce(new Error('IPC kaboom'));

    await act(async () => {
      await useSpecWriterStore.getState().applyHandshakeAnswers(PROJECT, [
        { capabilityId: 'llm-key.openai', action: 'verify' },
      ]);
    });

    const record = useSpecWriterStore.getState().projectCapabilities.get(PROJECT)!;
    const openai = record.capabilities.find((c) => c.id === 'llm-key.openai')!;
    expect(openai.status).toBe('absent');
    expect(openai.evidence).toContain('IPC failed');
    expect(useSpecWriterStore.getState().pendingHandshakeQuestions.get(PROJECT)).toBeUndefined();
  });
});
