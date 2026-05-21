/**
 * Tests for tauri-commands.ts
 *
 * The Tauri runtime (invoke, listen) is mocked globally in src/test/setup.ts.
 * These tests verify that each exported function calls invoke/listen with the
 * correct command name and argument shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

// Import after mocks are in place (setup.ts runs before this file)
import {
  checkClaudeStatus,
  setClaudeBinaryOverride,
  createSession,
  pauseSessionProcess,
  resumeSessionProcess,
  checkProcessAlive,
  sendMessage,
  setSessionMode,
  syncSessionMode,
  resolveToolApproval,
  closeSession,
  getSession,
  listSessions,
  renameSession,
  listPersistedSessions,
  deletePersistedSession,
  interruptSession,
  setSessionModel,
  initializeSession,
  listSessionHistory,
  readFileTree,
  readFileContent,
  writeFileContent,
  renameFile,
  deleteFile,
  duplicateFile,
  createFile,
  createDirectory,
  readFileBytes,
  saveClipboardImage,
  getFileInfo,
  cleanupOldAttachments,
  createTerminal,
  sendTerminalInput,
  resizeTerminal,
  closeTerminal,
  listTerminals,
  listenTerminalOutput,
  getSettings,
  updateSettings,
  generateChangelogEntry,
  getChangelogEntries,
  getProjectChangelogEntries,
  deleteChangelogEntry,
  testChangelogApiKey,
  getApiLogs,
  getApiCostSummary,
  cleanupApiLogs,
  sendAssistantChat,
  listenAssistantStream,
  cancelAssistantChat,
  getGitStatus,
  discoverCommands,
  expandSkill,
  runOneshotCommand,
  getMcpServers,
  saveMcpServer,
  deleteMcpServer,
  renameMcpServer,
  getMcpConfigPath,
  listTemplates,
  checkTemplatePrerequisites,
  installPrerequisite,
  scaffoldFromTemplate,
  scaffoldFromCli,
  verifyTemplate,
  listenScaffoldProgress,
  openPreviewWindow,
  closePreviewWindow,
  navigatePreview,
  refreshPreview,
  focusPreviewWindow,
  startDevServer,
  stopDevServer,
  getDevServerStatus,
  listenChatEvents,
  listenActivityEvents,
  listenToolApprovalRequests,
  listenSessionModeChanged,
  listenDevServerDetected,
  listenDevServerClosed,
  saveTaskBoardState,
  loadTaskBoardState,
  deleteTaskPlanById,
  archiveTaskPlan,
  saveSpecDocument,
  listSpecDocuments,
  readSpecDocument,
  deleteSpecDocument,
  gatherSpecContext,
  readProjectFiles,
  gatherProjectSnapshot,
  capturePreviewScreenshot,
  getPreviewConsoleLogs,
  listenPreviewConsoleEntry,
} from "./tauri-commands";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: invoke resolves with undefined, listen resolves with a noop unlisten fn
  mockInvoke.mockResolvedValue(undefined);
  mockListen.mockResolvedValue(() => {});
});

// ---------------------------------------------------------------------------
// Helper to assert invoke was called with the right command + args
// ---------------------------------------------------------------------------
function expectInvoke(command: string, args?: Record<string, unknown>): void {
  if (args !== undefined) {
    expect(mockInvoke).toHaveBeenCalledWith(command, args);
  } else {
    expect(mockInvoke).toHaveBeenCalledWith(command);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
describe("checkClaudeStatus", () => {
  it("calls invoke with check_claude_status", async () => {
    mockInvoke.mockResolvedValueOnce({ installed: true, version: "1.0", authenticated: true, binary_path: null });
    await checkClaudeStatus();
    expectInvoke("check_claude_status");
  });
});

describe("setClaudeBinaryOverride", () => {
  it("calls invoke with set_claude_binary_override and path", async () => {
    mockInvoke.mockResolvedValueOnce({ installed: true, version: "1.0", authenticated: true, binary_path: "/usr/local/bin/claude" });
    await setClaudeBinaryOverride("/usr/local/bin/claude");
    expectInvoke("set_claude_binary_override", { path: "/usr/local/bin/claude" });
  });
});

// `isLegacyClaudePathActive` tests removed in v1.3.0 — the indicator was
// retired after the v1.2.0 soak (Phase 2 S8 per spec §12).

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------
describe("createSession", () => {
  it("calls invoke with create_session, projectPath, name, resumeCliSessionId", async () => {
    await createSession("/my/project", "My Session", "cli-123");
    expectInvoke("create_session", {
      projectPath: "/my/project",
      name: "My Session",
      resumeCliSessionId: "cli-123",
    });
  });

  it("passes undefined for optional args when not provided", async () => {
    await createSession("/my/project");
    expectInvoke("create_session", {
      projectPath: "/my/project",
      name: undefined,
      resumeCliSessionId: undefined,
    });
  });
});

describe("pauseSessionProcess", () => {
  it("calls invoke with pause_session_process and sessionId", async () => {
    await pauseSessionProcess("s1");
    expectInvoke("pause_session_process", { sessionId: "s1" });
  });
});

describe("resumeSessionProcess", () => {
  it("calls invoke with resume_session_process, sessionId, cliSessionId", async () => {
    await resumeSessionProcess("s1", "cli-abc");
    expectInvoke("resume_session_process", { sessionId: "s1", cliSessionId: "cli-abc" });
  });

  it("passes null cliSessionId when not provided", async () => {
    await resumeSessionProcess("s1");
    expectInvoke("resume_session_process", { sessionId: "s1", cliSessionId: undefined });
  });
});

describe("checkProcessAlive", () => {
  it("calls invoke with check_process_alive and sessionId", async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const result = await checkProcessAlive("s1");
    expectInvoke("check_process_alive", { sessionId: "s1" });
    expect(result).toBe(true);
  });
});

describe("sendMessage", () => {
  it("calls invoke with send_message, sessionId, prompt", async () => {
    await sendMessage("s1", "Hello, Claude!");
    expectInvoke("send_message", { sessionId: "s1", prompt: "Hello, Claude!" });
  });
});

describe("setSessionMode", () => {
  it("calls invoke with set_session_mode, sessionId, mode", async () => {
    await setSessionMode("s1", "auto");
    expectInvoke("set_session_mode", { sessionId: "s1", mode: "auto" });
  });
});

describe("syncSessionMode", () => {
  it("calls invoke with sync_session_mode, sessionId, mode", async () => {
    await syncSessionMode("s1", "manual");
    expectInvoke("sync_session_mode", { sessionId: "s1", mode: "manual" });
  });
});

describe("resolveToolApproval", () => {
  it("calls invoke with resolve_tool_approval, requestId, approved, reason", async () => {
    await resolveToolApproval("req-1", true, "looks fine");
    expectInvoke("resolve_tool_approval", { requestId: "req-1", approved: true, reason: "looks fine" });
  });

  it("passes undefined reason when not provided", async () => {
    await resolveToolApproval("req-1", false);
    expectInvoke("resolve_tool_approval", { requestId: "req-1", approved: false, reason: undefined });
  });
});

describe("closeSession", () => {
  it("calls invoke with close_session and sessionId", async () => {
    await closeSession("s1");
    expectInvoke("close_session", { sessionId: "s1" });
  });
});

describe("getSession", () => {
  it("calls invoke with get_session and sessionId", async () => {
    await getSession("s1");
    expectInvoke("get_session", { sessionId: "s1" });
  });
});

describe("listSessions", () => {
  it("calls invoke with list_sessions (no args)", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listSessions();
    expectInvoke("list_sessions");
  });
});

describe("renameSession", () => {
  it("calls invoke with rename_session, sessionId, newName", async () => {
    await renameSession("s1", "My Renamed Session");
    expectInvoke("rename_session", { sessionId: "s1", newName: "My Renamed Session" });
  });
});

describe("listPersistedSessions", () => {
  it("calls invoke with list_persisted_sessions", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listPersistedSessions();
    expectInvoke("list_persisted_sessions");
  });
});

describe("deletePersistedSession", () => {
  it("calls invoke with delete_persisted_session and sessionId", async () => {
    await deletePersistedSession("s1");
    expectInvoke("delete_persisted_session", { sessionId: "s1" });
  });
});

describe("interruptSession", () => {
  it("calls invoke with interrupt_session and sessionId", async () => {
    await interruptSession("s1");
    expectInvoke("interrupt_session", { sessionId: "s1" });
  });
});

describe("setSessionModel", () => {
  it("calls invoke with set_session_model, sessionId, model", async () => {
    await setSessionModel("s1", "claude-opus-4");
    expectInvoke("set_session_model", { sessionId: "s1", model: "claude-opus-4" });
  });
});

describe("initializeSession", () => {
  it("calls invoke with initialize_session and sessionId", async () => {
    await initializeSession("s1");
    expectInvoke("initialize_session", { sessionId: "s1" });
  });
});

describe("listSessionHistory", () => {
  it("calls invoke with list_session_history and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listSessionHistory("/my/project");
    expectInvoke("list_session_history", { projectPath: "/my/project" });
  });
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
describe("readFileTree", () => {
  it("calls invoke with read_file_tree and rootPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await readFileTree("/my/project");
    expectInvoke("read_file_tree", { rootPath: "/my/project" });
  });
});

describe("readFileContent", () => {
  it("calls invoke with read_file_content and filePath", async () => {
    mockInvoke.mockResolvedValueOnce("file contents");
    const result = await readFileContent("/my/file.ts");
    expectInvoke("read_file_content", { filePath: "/my/file.ts" });
    expect(result).toBe("file contents");
  });
});

describe("writeFileContent", () => {
  it("calls invoke with write_file_content, filePath, content", async () => {
    await writeFileContent("/my/file.ts", "new content");
    expectInvoke("write_file_content", { filePath: "/my/file.ts", content: "new content" });
  });
});

describe("renameFile", () => {
  it("calls invoke with rename_file, oldPath, newPath", async () => {
    await renameFile("/old/path.ts", "/new/path.ts");
    expectInvoke("rename_file", { oldPath: "/old/path.ts", newPath: "/new/path.ts" });
  });
});

describe("deleteFile", () => {
  it("calls invoke with delete_file and filePath", async () => {
    await deleteFile("/my/file.ts");
    expectInvoke("delete_file", { filePath: "/my/file.ts" });
  });
});

describe("duplicateFile", () => {
  it("calls invoke with duplicate_file and filePath", async () => {
    mockInvoke.mockResolvedValueOnce("/my/file_copy.ts");
    const result = await duplicateFile("/my/file.ts");
    expectInvoke("duplicate_file", { filePath: "/my/file.ts" });
    expect(result).toBe("/my/file_copy.ts");
  });
});

describe("createFile", () => {
  it("calls invoke with create_file and filePath", async () => {
    await createFile("/my/new-file.ts");
    expectInvoke("create_file", { filePath: "/my/new-file.ts" });
  });
});

describe("createDirectory", () => {
  it("calls invoke with create_directory and dirPath", async () => {
    await createDirectory("/my/new-dir");
    expectInvoke("create_directory", { dirPath: "/my/new-dir" });
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
describe("readFileBytes", () => {
  it("calls invoke with read_file_bytes and filePath", async () => {
    mockInvoke.mockResolvedValueOnce([1, 2, 3]);
    const result = await readFileBytes("/my/image.png");
    expectInvoke("read_file_bytes", { filePath: "/my/image.png" });
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("saveClipboardImage", () => {
  it("calls invoke with save_clipboard_image, projectPath, imageData, filename", async () => {
    const info = {
      file_path: "/project/.attachments/img.png",
      file_name: "img.png",
      file_size: 100,
      mime_type: "image/png",
      is_image: true,
    };
    mockInvoke.mockResolvedValueOnce(info);
    const result = await saveClipboardImage("/project", [1, 2, 3], "img.png");
    expectInvoke("save_clipboard_image", {
      projectPath: "/project",
      imageData: [1, 2, 3],
      filename: "img.png",
    });
    expect(result).toEqual(info);
  });
});

describe("getFileInfo", () => {
  it("calls invoke with get_file_info and filePath", async () => {
    await getFileInfo("/my/file.ts");
    expectInvoke("get_file_info", { filePath: "/my/file.ts" });
  });
});

describe("cleanupOldAttachments", () => {
  it("calls invoke with cleanup_old_attachments, projectPath, maxAgeDays", async () => {
    mockInvoke.mockResolvedValueOnce(5);
    const result = await cleanupOldAttachments("/project", 30);
    expectInvoke("cleanup_old_attachments", { projectPath: "/project", maxAgeDays: 30 });
    expect(result).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------
describe("createTerminal", () => {
  it("calls invoke with create_terminal and all args", async () => {
    mockInvoke.mockResolvedValueOnce({ id: "t1", session_id: "s1", name: "bash" });
    await createTerminal("s1", "/project", "/bin/bash", "My Terminal", ["--login"]);
    expectInvoke("create_terminal", {
      sessionId: "s1",
      cwd: "/project",
      shell: "/bin/bash",
      name: "My Terminal",
      args: ["--login"],
    });
  });

  it("passes undefined for optional args when not provided", async () => {
    mockInvoke.mockResolvedValueOnce({ id: "t1", session_id: "s1", name: "default" });
    await createTerminal("s1", "/project");
    expectInvoke("create_terminal", {
      sessionId: "s1",
      cwd: "/project",
      shell: undefined,
      name: undefined,
      args: undefined,
    });
  });
});

describe("sendTerminalInput", () => {
  it("calls invoke with send_terminal_input, terminalId, data", async () => {
    await sendTerminalInput("t1", "ls -la\n");
    expectInvoke("send_terminal_input", { terminalId: "t1", data: "ls -la\n" });
  });
});

describe("resizeTerminal", () => {
  it("calls invoke with resize_terminal, terminalId, cols, rows", async () => {
    await resizeTerminal("t1", 80, 24);
    expectInvoke("resize_terminal", { terminalId: "t1", cols: 80, rows: 24 });
  });
});

describe("closeTerminal", () => {
  it("calls invoke with close_terminal and terminalId", async () => {
    await closeTerminal("t1");
    expectInvoke("close_terminal", { terminalId: "t1" });
  });
});

describe("listTerminals", () => {
  it("calls invoke with list_terminals and sessionId", async () => {
    mockInvoke.mockResolvedValueOnce(["t1", "t2"]);
    const result = await listTerminals("s1");
    expectInvoke("list_terminals", { sessionId: "s1" });
    expect(result).toEqual(["t1", "t2"]);
  });
});

describe("listenTerminalOutput", () => {
  it("calls listen with the correct event name for the given terminalId", async () => {
    const cb = vi.fn();
    await listenTerminalOutput("t1", cb);
    expect(mockListen).toHaveBeenCalledWith("terminal-output-t1", expect.any(Function));
  });

  it("invokes the callback with the event payload", async () => {
    let capturedHandler: ((e: { payload: string }) => void) | undefined;
    mockListen.mockImplementationOnce((_event, handler) => {
      capturedHandler = handler as (e: { payload: string }) => void;
      return Promise.resolve(() => {});
    });

    const cb = vi.fn();
    await listenTerminalOutput("t1", cb);

    capturedHandler!({ payload: "terminal data" });
    expect(cb).toHaveBeenCalledWith("terminal data");
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
describe("getSettings", () => {
  it("calls invoke with get_settings", async () => {
    await getSettings();
    expectInvoke("get_settings");
  });
});

describe("updateSettings", () => {
  it("calls invoke with update_settings and settings object", async () => {
    const settings = { theme: "midnight" } as Parameters<typeof updateSettings>[0];
    await updateSettings(settings);
    expectInvoke("update_settings", { settings });
  });
});

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------
describe("generateChangelogEntry", () => {
  it("calls invoke with generate_changelog_entry and all args", async () => {
    await generateChangelogEntry("s1", "prompt", "summary", ["read_file"], "auto");
    expectInvoke("generate_changelog_entry", {
      sessionId: "s1",
      userPrompt: "prompt",
      assistantSummary: "summary",
      toolsUsed: ["read_file"],
      sessionMode: "auto",
    });
  });
});

describe("getChangelogEntries", () => {
  it("calls invoke with get_changelog_entries and sessionId", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await getChangelogEntries("s1");
    expectInvoke("get_changelog_entries", { sessionId: "s1" });
  });
});

describe("getProjectChangelogEntries", () => {
  it("calls invoke with get_project_changelog_entries and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await getProjectChangelogEntries("/project");
    expectInvoke("get_project_changelog_entries", { projectPath: "/project" });
  });
});

describe("deleteChangelogEntry", () => {
  it("calls invoke with delete_changelog_entry and entryId", async () => {
    await deleteChangelogEntry("entry-1");
    expectInvoke("delete_changelog_entry", { entryId: "entry-1" });
  });
});

describe("testChangelogApiKey", () => {
  it("calls invoke with test_changelog_api_key and all args", async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const result = await testChangelogApiKey("anthropic", "sk-ant-xxx", "claude-haiku-4");
    expectInvoke("test_changelog_api_key", {
      provider: "anthropic",
      apiKey: "sk-ant-xxx",
      model: "claude-haiku-4",
    });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// API Logs
// ---------------------------------------------------------------------------
describe("getApiLogs", () => {
  it("calls invoke with get_api_logs", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await getApiLogs();
    expectInvoke("get_api_logs");
  });
});

describe("getApiCostSummary", () => {
  it("calls invoke with get_api_cost_summary", async () => {
    await getApiCostSummary();
    expectInvoke("get_api_cost_summary");
  });
});

describe("cleanupApiLogs", () => {
  it("calls invoke with cleanup_api_logs and maxAgeDays", async () => {
    mockInvoke.mockResolvedValueOnce(3);
    const result = await cleanupApiLogs(14);
    expectInvoke("cleanup_api_logs", { maxAgeDays: 14 });
    expect(result).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Assistant Chat
// ---------------------------------------------------------------------------
describe("sendAssistantChat", () => {
  it("calls invoke with send_assistant_chat and params object", async () => {
    const params = {
      assistantId: "a1",
      provider: "anthropic",
      apiKey: "sk-ant",
      model: "claude-sonnet-4",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 1024,
    };
    await sendAssistantChat(params);
    expect(mockInvoke).toHaveBeenCalledWith("send_assistant_chat", params);
  });
});

describe("listenAssistantStream", () => {
  it("calls listen with the correct event name for the given assistantId", async () => {
    const cb = vi.fn();
    await listenAssistantStream("a1", cb);
    expect(mockListen).toHaveBeenCalledWith("assistant-stream-a1", expect.any(Function));
  });

  it("invokes the callback with the event payload", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementationOnce((_event, handler) => {
      capturedHandler = handler as (e: { payload: unknown }) => void;
      return Promise.resolve(() => {});
    });

    const cb = vi.fn();
    await listenAssistantStream("a1", cb);

    const payload = { type: "delta", text: "Hello" };
    capturedHandler!({ payload });
    expect(cb).toHaveBeenCalledWith(payload);
  });
});

describe("cancelAssistantChat", () => {
  it("calls invoke with cancel_assistant_chat and assistantId", async () => {
    await cancelAssistantChat("a1");
    expectInvoke("cancel_assistant_chat", { assistantId: "a1" });
  });
});

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------
describe("getGitStatus", () => {
  it("calls invoke with get_git_status and projectPath", async () => {
    await getGitStatus("/project");
    expectInvoke("get_git_status", { projectPath: "/project" });
  });
});

// ---------------------------------------------------------------------------
// Slash Commands
// ---------------------------------------------------------------------------
describe("discoverCommands", () => {
  it("calls invoke with discover_commands and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await discoverCommands("/project");
    expectInvoke("discover_commands", { projectPath: "/project" });
  });
});

describe("expandSkill", () => {
  it("calls invoke with expand_skill and all args (arguments_ mapped to arguments)", async () => {
    await expandSkill("/project", "/project/.claude/commands/test.md", "--verbose", "cli-session-1");
    expectInvoke("expand_skill", {
      projectPath: "/project",
      sourcePath: "/project/.claude/commands/test.md",
      arguments: "--verbose",
      cliSessionId: "cli-session-1",
    });
  });
});

describe("runOneshotCommand", () => {
  it("calls invoke with run_oneshot_command, projectPath, args", async () => {
    await runOneshotCommand("/project", ["--print", "hello"]);
    expectInvoke("run_oneshot_command", { projectPath: "/project", args: ["--print", "hello"] });
  });
});

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------
describe("getMcpServers", () => {
  it("calls invoke with get_mcp_servers (no projectPath)", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await getMcpServers();
    expectInvoke("get_mcp_servers", { projectPath: undefined });
  });

  it("calls invoke with get_mcp_servers with optional projectPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await getMcpServers("/project");
    expectInvoke("get_mcp_servers", { projectPath: "/project" });
  });
});

describe("saveMcpServer", () => {
  it("calls invoke with save_mcp_server, projectPath, server", async () => {
    const server = { name: "my-server", command: "node", args: [], scope: "global" as const, serverType: "stdio" as const };
    await saveMcpServer(null, server);
    expectInvoke("save_mcp_server", { projectPath: null, server });
  });
});

describe("deleteMcpServer", () => {
  it("calls invoke with delete_mcp_server, projectPath, name, scope", async () => {
    await deleteMcpServer("/project", "my-server", "local");
    expectInvoke("delete_mcp_server", { projectPath: "/project", name: "my-server", scope: "local" });
  });
});

describe("renameMcpServer", () => {
  it("calls invoke with rename_mcp_server and all args", async () => {
    await renameMcpServer("/project", "old-name", "new-name", "local");
    expectInvoke("rename_mcp_server", {
      projectPath: "/project",
      oldName: "old-name",
      newName: "new-name",
      scope: "local",
    });
  });
});

describe("getMcpConfigPath", () => {
  it("calls invoke with get_mcp_config_path, scope, projectPath", async () => {
    mockInvoke.mockResolvedValueOnce("/home/user/.config/claude/mcp.json");
    await getMcpConfigPath("global", "/project");
    expectInvoke("get_mcp_config_path", { scope: "global", projectPath: "/project" });
  });
});

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------
describe("listTemplates", () => {
  it("calls invoke with list_templates", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listTemplates();
    expectInvoke("list_templates");
  });
});

describe("checkTemplatePrerequisites", () => {
  it("calls invoke with check_template_prerequisites and checks", async () => {
    const checks = [{ command: "node --version", label: "Node.js", required: true }] as const;
    mockInvoke.mockResolvedValueOnce([]);
    await checkTemplatePrerequisites(checks);
    expectInvoke("check_template_prerequisites", { checks });
  });
});

describe("installPrerequisite", () => {
  it("calls invoke with install_prerequisite and command", async () => {
    await installPrerequisite("brew install node");
    expectInvoke("install_prerequisite", { command: "brew install node" });
  });
});

describe("scaffoldFromTemplate", () => {
  it("calls invoke with scaffold_from_template and all args", async () => {
    await scaffoldFromTemplate("react-ts", "/projects", "MyApp");
    expectInvoke("scaffold_from_template", {
      templateId: "react-ts",
      projectPath: "/projects",
      projectName: "MyApp",
    });
  });
});

describe("scaffoldFromCli", () => {
  it("calls invoke with scaffold_from_cli and all args", async () => {
    await scaffoldFromCli("vite", "npm create vite@latest", "/projects", "MyApp", ["npm install"]);
    expectInvoke("scaffold_from_cli", {
      templateId: "vite",
      cliCommand: "npm create vite@latest",
      projectPath: "/projects",
      projectName: "MyApp",
      postCommands: ["npm install"],
    });
  });
});

describe("verifyTemplate", () => {
  it("calls invoke with verify_template and templateId", async () => {
    await verifyTemplate("react-ts");
    expectInvoke("verify_template", { templateId: "react-ts" });
  });
});

describe("listenScaffoldProgress", () => {
  it("calls listen with scaffold-progress event", async () => {
    const cb = vi.fn();
    await listenScaffoldProgress(cb);
    expect(mockListen).toHaveBeenCalledWith("scaffold-progress", expect.any(Function));
  });

  it("invokes the callback with the event payload", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementationOnce((_event, handler) => {
      capturedHandler = handler as (e: { payload: unknown }) => void;
      return Promise.resolve(() => {});
    });

    const cb = vi.fn();
    await listenScaffoldProgress(cb);

    const payload = { step: "installing", progress: 50 };
    capturedHandler!({ payload });
    expect(cb).toHaveBeenCalledWith(payload);
  });
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
describe("openPreviewWindow", () => {
  it("calls invoke with open_preview_window and all args", async () => {
    await openPreviewWindow("http://localhost:3000", "MyApp", "/Users/test/MyApp", 1280, 800);
    expectInvoke("open_preview_window", {
      url: "http://localhost:3000",
      projectName: "MyApp",
      projectPath: "/Users/test/MyApp",
      width: 1280,
      height: 800,
    });
  });
});

describe("closePreviewWindow", () => {
  it("calls invoke with close_preview_window", async () => {
    await closePreviewWindow();
    expectInvoke("close_preview_window");
  });
});

describe("navigatePreview", () => {
  it("calls invoke with navigate_preview and url", async () => {
    await navigatePreview("http://localhost:3000/about");
    expectInvoke("navigate_preview", { url: "http://localhost:3000/about" });
  });
});

describe("refreshPreview", () => {
  it("calls invoke with refresh_preview", async () => {
    await refreshPreview();
    expectInvoke("refresh_preview");
  });
});

describe("focusPreviewWindow", () => {
  it("calls invoke with focus_preview_window", async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const result = await focusPreviewWindow();
    expectInvoke("focus_preview_window");
    expect(result).toBe(true);
  });
});

describe("startDevServer", () => {
  it("calls invoke with start_dev_server and all args", async () => {
    mockInvoke.mockResolvedValueOnce("term-1");
    const result = await startDevServer("/project", "npm run dev", 3000);
    expectInvoke("start_dev_server", {
      projectPath: "/project",
      devCommand: "npm run dev",
      devPort: 3000,
    });
    expect(result).toBe("term-1");
  });
});

describe("stopDevServer", () => {
  it("calls invoke with stop_dev_server and projectPath", async () => {
    await stopDevServer("/project");
    expectInvoke("stop_dev_server", { projectPath: "/project" });
  });
});

describe("getDevServerStatus", () => {
  it("calls invoke with get_dev_server_status and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await getDevServerStatus("/project");
    expectInvoke("get_dev_server_status", { projectPath: "/project" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
describe("listenChatEvents", () => {
  it("calls listen with the correct session event name", async () => {
    const cb = vi.fn();
    await listenChatEvents("s1", cb);
    expect(mockListen).toHaveBeenCalledWith("claude-chat-s1", expect.any(Function));
  });

  it("invokes the callback with the event payload", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementationOnce((_event, handler) => {
      capturedHandler = handler as (e: { payload: unknown }) => void;
      return Promise.resolve(() => {});
    });

    const cb = vi.fn();
    await listenChatEvents("s1", cb);

    const payload = { type: "message" };
    capturedHandler!({ payload });
    expect(cb).toHaveBeenCalledWith(payload);
  });
});

describe("listenActivityEvents", () => {
  it("calls listen with the correct session event name", async () => {
    const cb = vi.fn();
    await listenActivityEvents("s1", cb);
    expect(mockListen).toHaveBeenCalledWith("claude-activity-s1", expect.any(Function));
  });
});

describe("listenToolApprovalRequests", () => {
  it("calls listen with tool-approval-request event", async () => {
    const cb = vi.fn();
    await listenToolApprovalRequests(cb);
    expect(mockListen).toHaveBeenCalledWith("tool-approval-request", expect.any(Function));
  });
});

describe("listenSessionModeChanged", () => {
  it("calls listen with session-mode-changed event", async () => {
    const cb = vi.fn();
    await listenSessionModeChanged(cb);
    expect(mockListen).toHaveBeenCalledWith("session-mode-changed", expect.any(Function));
  });
});

describe("listenDevServerDetected", () => {
  it("calls listen with dev-server-detected event", async () => {
    const cb = vi.fn();
    await listenDevServerDetected(cb);
    expect(mockListen).toHaveBeenCalledWith("dev-server-detected", expect.any(Function));
  });
});

describe("listenDevServerClosed", () => {
  it("calls listen with dev-server-closed event", async () => {
    const cb = vi.fn();
    await listenDevServerClosed(cb);
    expect(mockListen).toHaveBeenCalledWith("dev-server-closed", expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// SpecWriter
// ---------------------------------------------------------------------------
describe("saveTaskBoardState", () => {
  it("calls invoke with save_task_board_state, projectPath, stateJson", async () => {
    await saveTaskBoardState("/project", '{"columns":[]}');
    expectInvoke("save_task_board_state", { projectPath: "/project", stateJson: '{"columns":[]}' });
  });
});

describe("loadTaskBoardState", () => {
  it("calls invoke with load_task_board_state and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await loadTaskBoardState("/project");
    expectInvoke("load_task_board_state", { projectPath: "/project" });
    expect(result).toBeNull();
  });
});

describe("deleteTaskPlanById", () => {
  it("calls invoke with delete_task_plan_cmd and planId", async () => {
    await deleteTaskPlanById("plan-1");
    expectInvoke("delete_task_plan_cmd", { planId: "plan-1" });
  });
});

describe("archiveTaskPlan", () => {
  it("calls invoke with archive_task_plan_cmd and planId", async () => {
    await archiveTaskPlan("plan-1");
    expectInvoke("archive_task_plan_cmd", { planId: "plan-1" });
  });
});

describe("saveSpecDocument", () => {
  it("calls invoke with save_spec_document and all args", async () => {
    mockInvoke.mockResolvedValueOnce("/project/specs/my-spec.md");
    const result = await saveSpecDocument("/project", "my-spec.md", "# Spec", true);
    expectInvoke("save_spec_document", {
      projectPath: "/project",
      filename: "my-spec.md",
      content: "# Spec",
      overwrite: true,
    });
    expect(result).toBe("/project/specs/my-spec.md");
  });
});

describe("listSpecDocuments", () => {
  it("calls invoke with list_spec_documents and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listSpecDocuments("/project");
    expectInvoke("list_spec_documents", { projectPath: "/project" });
  });
});

describe("readSpecDocument", () => {
  it("calls invoke with read_spec_document, projectPath, filename", async () => {
    mockInvoke.mockResolvedValueOnce("# My Spec");
    const result = await readSpecDocument("/project", "my-spec.md");
    expectInvoke("read_spec_document", { projectPath: "/project", filename: "my-spec.md" });
    expect(result).toBe("# My Spec");
  });
});

describe("deleteSpecDocument", () => {
  it("calls invoke with delete_spec_document, projectPath, filename", async () => {
    await deleteSpecDocument("/project", "my-spec.md");
    expectInvoke("delete_spec_document", { projectPath: "/project", filename: "my-spec.md" });
  });
});

describe("gatherSpecContext", () => {
  it("calls invoke with gather_spec_context and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce("context text");
    const result = await gatherSpecContext("/project");
    expectInvoke("gather_spec_context", { projectPath: "/project" });
    expect(result).toBe("context text");
  });
});

describe("readProjectFiles", () => {
  it("calls invoke with read_project_files and all args", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await readProjectFiles("/project", ["src/index.ts", "src/app.ts"], 200);
    expectInvoke("read_project_files", {
      projectPath: "/project",
      filePaths: ["src/index.ts", "src/app.ts"],
      maxLines: 200,
    });
  });
});

describe("gatherProjectSnapshot", () => {
  it("calls invoke with gather_project_snapshot and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce("snapshot");
    const result = await gatherProjectSnapshot("/project");
    expectInvoke("gather_project_snapshot", { projectPath: "/project" });
    expect(result).toBe("snapshot");
  });
});

describe("capturePreviewScreenshot", () => {
  it("calls invoke with capture_preview_screenshot", async () => {
    mockInvoke.mockResolvedValueOnce("data:image/png;base64,abc123");
    const result = await capturePreviewScreenshot();
    expectInvoke("capture_preview_screenshot");
    expect(result).toBe("data:image/png;base64,abc123");
  });
});

describe("getPreviewConsoleLogs", () => {
  it("calls invoke with get_preview_console_logs and projectPath", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const result = await getPreviewConsoleLogs("/project");
    expectInvoke("get_preview_console_logs", { projectPath: "/project" });
    expect(result).toEqual([]);
  });
});

describe("listenPreviewConsoleEntry", () => {
  it("calls listen with preview-console-entry event", async () => {
    const cb = vi.fn();
    await listenPreviewConsoleEntry(cb);
    expect(mockListen).toHaveBeenCalledWith("preview-console-entry", expect.any(Function));
  });

  it("invokes the callback with the event payload", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementationOnce((_event, handler) => {
      capturedHandler = handler as (e: { payload: unknown }) => void;
      return Promise.resolve(() => {});
    });

    const cb = vi.fn();
    await listenPreviewConsoleEntry(cb);

    const payload = { level: "error", ts: "2026-01-01T00:00:00Z", msg: "Uncaught Error", url: "http://localhost:3000", stack: "Error: ..." };
    capturedHandler!({ payload });
    expect(cb).toHaveBeenCalledWith(payload);
  });
});
