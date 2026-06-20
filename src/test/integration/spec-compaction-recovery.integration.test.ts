/**
 * Integration test: SpecWriter creation-log + post-compaction recap.
 *
 * Drives a streaming spec turn that emits headings, simulates a
 * `compact_complete` event mid-stream (Claude-CLI path), continues with more
 * headings, completes the turn, then sends a fresh user turn and asserts the
 * recap was prepended into the prompt sent to the CLI. Mirrors the
 * spec-audit-recheck.integration.test.ts style.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resetAllStores } from '../helpers/store-reset';
import { useSpecWriterStore } from '../../stores/specWriterStore';
import { useSettingsStore } from '../../stores/settingsStore';

// ── Mock Tauri IPC ──────────────────────────────────────────────────────────

const _sendMessageMock = vi.fn().mockResolvedValue(undefined);

const _eventHandlersBySessionId: Map<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (event: any) => void
> = new Map();

vi.mock('../../lib/tauri-commands', () => ({
  createSpecwriterSession: vi.fn().mockResolvedValue('session-1'),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: (...args: unknown[]) => _sendMessageMock(...args),
  interruptSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn(
    async (
      sessionId: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (event: any) => void,
    ) => {
      _eventHandlersBySessionId.set(sessionId, handler);
      return () => {
        _eventHandlersBySessionId.delete(sessionId);
      };
    },
  ),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue(''),
  readFileContent: vi.fn().mockResolvedValue(''),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../stores/toastStore', () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock('../../lib/spec-prompts', () => ({
  SPEC_READY_PATTERNS: [/READY_TO_WRITE/],
  SPEC_START_PATTERN: /^# Specification/m,
  AUDIT_START_PATTERN: /^# Verification Audit/m,
  AUDIT_FILE_PATTERN: /audit saved to: (.+)/i,
  isLikelySpecDocument: vi.fn().mockReturnValue(false),
  buildClaudeCodePrompt: vi.fn().mockReturnValue('system prompt'),
}));

vi.mock('../../lib/spec-option-parser', () => ({
  parseSelectableOptions: vi.fn().mockReturnValue(null),
}));

import { useSpecConversationClaude } from '../../hooks/useSpecConversationClaude';

function setupSettings(): void {
  useSettingsStore.setState({
    settings: {
      theme: 'sand',
      fontSize: 13,
      sendShortcut: 'enter',
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: {},
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: 'gemini',
      changelogModel: 'gemini-2.5-flash-lite',
      changelogPrompt: '',
      assistantShortcuts: [],
      assistantDefaultProvider: 'claude-code',
      assistantDefaultModel: {},
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: 'claude-sonnet-4-6',
      taskBoardMaxTokens: 64000,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
      triviaEnabled: false,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      claudeBinaryOverride: null,
      onboardingCompleted: false,
      apiKeyBannerDismissed: false,
      lastCloneDirectory: null,
      sessionLogsEnabled: false,
      codexDebugLoggingEnabled: true,
      sessionLogsRetentionDays: 30,
      superBroEnabled: false,
      superBroProvider: 'auto',
      superBroModel: 'auto',
      selfDriveProvider: 'anthropic',
      selfDriveModel: 'claude-haiku-4-5',
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: true,
      selfDriveAutoCommit: false,
      selfDriveEnableRecheckLoop: true,
      selfDriveConfirmCapabilities: true,
      defaultThinkingEffort: null,
      defaultAgentByTask: {},
      maxCodingAgentSessions: 20,
      secondOpinionPrivacyAcknowledged: false,
    } as ReturnType<typeof useSettingsStore.getState>['settings'],
    loaded: true,
  });
}

async function waitForHandler(): Promise<(event: { type: string; text?: string; pre_tokens?: number; trigger?: string }) => void> {
  let attempts = 0;
  while (_eventHandlersBySessionId.size === 0 && attempts < 50) {
    await new Promise((r) => setTimeout(r, 5));
    attempts++;
  }
  const handler = [..._eventHandlersBySessionId.values()][0];
  if (!handler) throw new Error('chat-event handler never registered');
  return handler;
}

const PROJECT_PATH = '/tmp/spec-compaction-recovery';

describe('SpecWriter compaction recovery (Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    _eventHandlersBySessionId.clear();
    _sendMessageMock.mockClear();
  });

  it('records headings, marks post-compact entries, and prepends a recap on the next user turn', async () => {
    const { result } = renderHook(() => useSpecConversationClaude());

    // Turn 1 — user kicks off a long spec.
    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, 'Write me a spec for X.');
    });
    const handler = await waitForHandler();

    // Stream the first two headings.
    await act(async () => {
      handler({ type: 'text_delta', text: '# Project Title\n\nIntro body line.\n\n## 1. Overview\n\nOverview body.\n\n' });
    });
    // Let the rAF flush land.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Compaction fires here.
    await act(async () => {
      handler({ type: 'compact_complete', trigger: 'auto', pre_tokens: 186_000 });
    });

    // Stream more headings AFTER the compaction.
    await act(async () => {
      handler({ type: 'text_delta', text: '## 2. Data Model\n\nData body.\n\n### Session 1: Foundation\n\nFoundation body.\n\n' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Close the turn.
    await act(async () => {
      handler({ type: 'turn_complete' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Verify the creation log captured the right sections with the right
    // post-compaction flags.
    const log = useSpecWriterStore.getState().creationLogs.get(PROJECT_PATH);
    expect(log).toBeDefined();
    const titles = log!.entries.map((e) => e.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'Project Title',
        '1. Overview',
        '2. Data Model',
        'Session 1: Foundation',
      ]),
    );
    // Pre-compact entries: those that started BEFORE compact_complete.
    const preCompact = log!.entries.filter((e) => !e.postCompaction);
    const postCompact = log!.entries.filter((e) => e.postCompaction);
    expect(preCompact.map((e) => e.title)).toEqual(
      expect.arrayContaining(['Project Title', '1. Overview']),
    );
    expect(postCompact.map((e) => e.title)).toEqual(
      expect.arrayContaining(['2. Data Model', 'Session 1: Foundation']),
    );
    // compactedAt is stamped.
    expect(log!.compactedAt).not.toBeNull();
    // Compaction info is set on the store.
    expect(useSpecWriterStore.getState().compactionInfo.get(PROJECT_PATH)).toBeDefined();

    // Turn 2 — user sends a follow-up message. The recap should be prepended
    // to the prompt argument passed to the underlying CLI sendMessage.
    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, 'Please continue.');
    });
    // The mock receives (sessionId, prompt, attachments?) — pull the second
    // call (Turn 2). The first call was for Turn 1.
    expect(_sendMessageMock).toHaveBeenCalled();
    const turn2Call = _sendMessageMock.mock.calls[_sendMessageMock.mock.calls.length - 1];
    const promptArg = turn2Call[1] as string;
    expect(promptArg).toContain('SpecWriter creation log');
    expect(promptArg).toContain('Sections completed pre-compact');
    expect(promptArg).toContain('Sections written post-compact');
    expect(promptArg).toContain('Project Title');
    expect(promptArg).toContain('2. Data Model');
    expect(promptArg).toContain('Do NOT rewrite completed sections');
    // The user's actual message is still in there too.
    expect(promptArg).toContain('Please continue.');

    // The creation log is cleared at the start of the new user turn.
    const log2 = useSpecWriterStore.getState().creationLogs.get(PROJECT_PATH);
    // After turn 2 has started, it may already have new entries from the new
    // stream, but those are post-clear and won't include the pre-compact
    // titles unless they restream them.
    if (log2) {
      expect(log2.entries.find((e) => e.title === 'Project Title')).toBeUndefined();
    }
  });

  it('does NOT inject the recap when there was no compaction event', async () => {
    const { result } = renderHook(() => useSpecConversationClaude());

    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, 'Write a small spec.');
    });
    const handler = await waitForHandler();

    await act(async () => {
      handler({ type: 'text_delta', text: '# Title\n\n## 1. Done\n' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await act(async () => {
      handler({ type: 'turn_complete' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Next turn — no compaction info → no recap.
    await act(async () => {
      await result.current.sendMessage(PROJECT_PATH, 'Follow-up.');
    });
    const turn2Call = _sendMessageMock.mock.calls[_sendMessageMock.mock.calls.length - 1];
    const promptArg = turn2Call[1] as string;
    expect(promptArg).not.toContain('SpecWriter creation log');
    expect(promptArg).toContain('Follow-up.');
  });
});
