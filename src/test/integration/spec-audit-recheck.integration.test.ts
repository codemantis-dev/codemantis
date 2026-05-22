/**
 * Integration test: SpecWriter coverage repair (AUDIT-PATCH splice).
 *
 * Verifies that when an auto-recheck reply arrives in `<!-- AUDIT-PATCH -->`
 * format the splicer merges it into the existing spec rather than letting the
 * patch text overwrite `currentSpecContent`. Also covers the fail-closed path
 * where a malformed patch leaves the original spec intact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resetAllStores } from '../helpers/store-reset';
import { useSpecWriterStore } from '../../stores/specWriterStore';
import { useSettingsStore } from '../../stores/settingsStore';

// ── Mock Tauri IPC ──────────────────────────────────────────────────────────

vi.mock('../../lib/tauri-commands', () => ({
  sendAssistantChat: vi.fn().mockResolvedValue(undefined),
  listenAssistantStream: vi.fn(
    async (
      id: string,
      handler: (event: { type: string; text?: string; content?: string; message?: string }) => void,
    ) => {
      _streamHandlersById.set(id, handler);
      return () => {
        _streamHandlersById.delete(id);
      };
    },
  ),
  cancelAssistantChat: vi.fn().mockResolvedValue(undefined),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue(''),
  readFileContent: vi.fn().mockResolvedValue(''),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
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
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
}));

vi.mock('../../lib/spec-option-parser', () => ({
  parseSelectableOptions: vi.fn().mockReturnValue(null),
}));

vi.mock('../../lib/spec-file-requests', () => ({
  handleFileRequests: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/file-utils', () => ({
  fileToBase64: vi.fn().mockResolvedValue({ data: '', mimeType: 'text/plain' }),
  isTextMime: vi.fn().mockReturnValue(true),
}));

import { useSpecConversation } from '../../hooks/useSpecConversation';

const _streamHandlersById: Map<
  string,
  (event: { type: string; text?: string; content?: string; message?: string }) => void
> = new Map();
const assistantIdFor = (projectPath: string): string =>
  `spec-${projectPath.replace(/[^a-zA-Z0-9]/g, '_')}`;

const PROJECT_PATH = '/tmp/test-audit-recheck';

const ORIGINAL_SPEC = [
  '# Project — Specification',
  '',
  '## §1 Overview',
  '',
  'Original overview content. Lorem ipsum dolor sit amet, consectetur adipiscing',
  'elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  '',
  '## §2 Architecture',
  '',
  'Original architecture content. Sufficient body to keep the byte-ratio gate',
  'comfortable across edits — at least a few hundred characters of substance.',
  '',
  '### §2.1 Components',
  '',
  'Original components subsection. Lorem ipsum dolor sit amet.',
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
  'Original wrap-up content for §4 with enough length to keep things stable.',
  '',
].join('\n');

function setupSettings(): void {
  useSettingsStore.setState({
    settings: {
      theme: 'sand',
      fontSize: 13,
      sendShortcut: 'enter',
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: { gemini: 'test-key' },
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
      taskBoardPlanningModel: 'gemini-2.5-flash',
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
      secondOpinionPrivacyAcknowledged: false,
    } as ReturnType<typeof useSettingsStore.getState>['settings'],
    loaded: true,
  });
}

/** Drive a stream to a `done` event by handing the buffer over in one delta + done pair. */
async function driveStream(projectPath: string, replyText: string): Promise<void> {
  // listenAssistantStream is registered async — wait one tick for the handler.
  let attempts = 0;
  while (!_streamHandlersById.has(assistantIdFor(projectPath)) && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    attempts++;
  }
  const handler = _streamHandlersById.get(assistantIdFor(projectPath));
  if (!handler) throw new Error('stream handler never registered');
  await act(async () => {
    handler({ type: 'delta', text: replyText });
  });
  // Let the rAF flush land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    handler({ type: 'done' });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('SpecWriter audit-recheck splice (Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    _streamHandlersById.clear();
  });

  it('merges a valid AUDIT-PATCH into the existing spec instead of replacing it', async () => {
    const { result } = renderHook(() => useSpecConversation());

    // Seed the existing spec — this is what `state.preStreamSpec` will capture.
    useSpecWriterStore.setState((s) => ({
      currentSpecContent: new Map(s.currentSpecContent).set(PROJECT_PATH, ORIGINAL_SPEC),
    }));

    // Use the internal 4-arg form so we can flag this as an auto-recheck dispatch
    // (the public type omits `meta` but the implementation accepts it; the
    // production audit loop calls it the same way).
    const sendMessage = result.current.sendMessage as unknown as (
      projectPath: string,
      content: string,
      attachments?: undefined,
      meta?: { isAutoRecheck: boolean },
    ) => Promise<void>;

    await act(async () => {
      await sendMessage(PROJECT_PATH, 'recheck prompt', undefined, { isAutoRecheck: true });
    });

    const patchReply = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:replace-section heading="§2 Architecture" -->',
      '## §2 Architecture',
      '',
      'Replacement architecture content. Substantial replacement body that keeps',
      'the merged spec well above the 60% byte-ratio floor and preserves every',
      'sub-heading the original section had.',
      '',
      '### §2.1 Components',
      '',
      'Replacement components subsection.',
      '<!-- /patch -->',
    ].join('\n');

    await driveStream(PROJECT_PATH, patchReply);

    const merged = useSpecWriterStore.getState().currentSpecContent.get(PROJECT_PATH);
    expect(merged).toBeDefined();
    // The targeted section was replaced…
    expect(merged).toContain('Replacement architecture content');
    expect(merged).not.toContain('Original architecture content');
    // …while non-targeted sections survive intact.
    expect(merged).toContain('# Project — Specification');
    expect(merged).toContain('Original overview content');
    expect(merged).toContain('_STAGE_REGISTRY = {');
    expect(merged).toContain('Original wrap-up content for §4');
    // The merged content must NOT be just the patch envelope.
    expect(merged).not.toMatch(/^<!-- AUDIT-PATCH -->/);

    // A success summary message should have been posted to the chat.
    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH);
    expect(conv).toBeDefined();
    const summary = conv!.messages.find(
      (m) => m.role === 'system' && m.content.includes('Coverage repair applied'),
    );
    expect(summary).toBeDefined();
  });

  it('preserves the original spec when the patch is malformed', async () => {
    const { result } = renderHook(() => useSpecConversation());

    useSpecWriterStore.setState((s) => ({
      currentSpecContent: new Map(s.currentSpecContent).set(PROJECT_PATH, ORIGINAL_SPEC),
    }));

    const sendMessage = result.current.sendMessage as unknown as (
      projectPath: string,
      content: string,
      attachments?: undefined,
      meta?: { isAutoRecheck: boolean },
    ) => Promise<void>;

    await act(async () => {
      await sendMessage(PROJECT_PATH, 'recheck prompt', undefined, { isAutoRecheck: true });
    });

    // Patch references a heading that does not exist — must fail-closed.
    const badPatch = [
      '<!-- AUDIT-PATCH -->',
      '<!-- patch:replace-section heading="§99 Nonexistent" -->',
      '## §99 Nonexistent',
      '',
      'whatever',
      '<!-- /patch -->',
    ].join('\n');

    await driveStream(PROJECT_PATH, badPatch);

    const after = useSpecWriterStore.getState().currentSpecContent.get(PROJECT_PATH);
    expect(after).toBe(ORIGINAL_SPEC);

    const conv = useSpecWriterStore.getState().getActiveConversation(PROJECT_PATH);
    const failureMsg = conv!.messages.find(
      (m) => m.role === 'system' && m.content.includes('could not be applied automatically'),
    );
    expect(failureMsg).toBeDefined();
    expect(failureMsg!.content).toContain('§99 Nonexistent');
  });

  it('preserves the original spec when the reply is missing the AUDIT-PATCH marker', async () => {
    const { result } = renderHook(() => useSpecConversation());

    useSpecWriterStore.setState((s) => ({
      currentSpecContent: new Map(s.currentSpecContent).set(PROJECT_PATH, ORIGINAL_SPEC),
    }));

    const sendMessage = result.current.sendMessage as unknown as (
      projectPath: string,
      content: string,
      attachments?: undefined,
      meta?: { isAutoRecheck: boolean },
    ) => Promise<void>;

    await act(async () => {
      await sendMessage(PROJECT_PATH, 'recheck prompt', undefined, { isAutoRecheck: true });
    });

    // No AUDIT-PATCH marker — the splicer is bypassed entirely. Without the
    // marker the response is plain prose, which (with the test mocks) won't
    // be classified as a spec, so currentSpecContent must remain untouched.
    await driveStream(PROJECT_PATH, 'Sure, here are the corrections in prose form…');

    const after = useSpecWriterStore.getState().currentSpecContent.get(PROJECT_PATH);
    expect(after).toBe(ORIGINAL_SPEC);
  });
});
