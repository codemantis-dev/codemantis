/**
 * Configurable Tauri command mock factories.
 * Use these to set up invoke() mocks that dispatch by command name.
 */
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

type CommandHandler = (...args: unknown[]) => unknown;
type CommandMap = Record<string, CommandHandler>;

/**
 * Configure the global invoke() mock to dispatch by command name.
 * Unmatched commands return undefined.
 *
 * @example
 * mockInvoke({
 *   get_settings: () => ({ theme: "dark", fontSize: 14 }),
 *   create_session: (args) => ({ id: "s1", name: args.name }),
 * });
 */
export function mockInvoke(commandMap: CommandMap): void {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
    const handler = commandMap[cmd];
    if (handler) {
      return Promise.resolve(handler(args));
    }
    return Promise.resolve(undefined);
  }) as typeof invoke);
}

/**
 * Pre-configured invoke mock for common session operations.
 * Provides sensible defaults that can be overridden.
 */
export function createMockInvokeForSession(
  overrides: CommandMap = {}
): void {
  const defaults: CommandMap = {
    get_settings: () => ({
      theme: "dark",
      fontSize: 14,
      sendShortcut: "cmdenter",
      triviaEnabled: false,
      changelogEnabled: false,
      changelogProvider: "anthropic",
      changelogModel: "claude-haiku-4-5",
      superBroEnabled: false,
      sessionLogsEnabled: true,
      sessionLogRetentionDays: 30,
      autoOpenFiles: true,
    }),
    create_session: (args: unknown) => {
      const a = args as Record<string, unknown>;
      return {
        id: a?.sessionId ?? "test-session-1",
        name: a?.name ?? "Test Session",
        project_path: a?.projectPath ?? "/tmp/test-project",
        status: "connected",
        model: "claude-sonnet-4-20250514",
        icon_index: 0,
      };
    },
    close_session: () => undefined,
    send_message: () => undefined,
    rename_session: () => undefined,
    listen_chat_events: () => undefined,
    listen_activity_events: () => undefined,
    read_file_content: () => "// file content",
    get_git_status: () => ({
      branch: "main",
      uncommittedChanges: 0,
      lastCommitTime: null,
      lastPushTime: null,
    }),
    save_session_messages: () => undefined,
    load_session_messages: () => [],
    interrupt_session: () => undefined,
    check_process_alive: () => true,
  };

  mockInvoke({ ...defaults, ...overrides });
}

/**
 * Reset the invoke mock to a clean vi.fn() state.
 */
export function resetInvokeMock(): void {
  vi.mocked(invoke).mockReset();
}
