import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CloneForm from "./CloneForm";
import { useSettingsStore } from "../../stores/settingsStore";
import type { AppSettings } from "../../types/settings";
import { getDefaultModelPricing } from "../../types/settings";

// ── Mocks ──

const { mockCloneFromGit, mockListenScaffoldProgress } = vi.hoisted(() => ({
  mockCloneFromGit: vi.fn(),
  mockListenScaffoldProgress: vi.fn(() =>
    Promise.resolve(() => {})
  ),
}));

vi.mock("../../lib/tauri-commands", () => ({
  cloneFromGit: mockCloneFromGit,
  listenScaffoldProgress: mockListenScaffoldProgress,
  getSettings: vi.fn(() => Promise.resolve({})),
  updateSettings: vi.fn(() => Promise.resolve()),
  loadObservations: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/Users/test/Projects")),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

// ── Helpers ──

const DEFAULT_SETTINGS: AppSettings = {
  theme: "midnight",
  fontSize: 13,
  sendShortcut: "cmd+enter",
  terminalShell: null,
  terminalFontSize: 13,
  quickCommands: [],
  apiKeys: {},
  modelPricing: getDefaultModelPricing(),
  changelogEnabled: false,
  changelogProvider: "gemini",
  changelogModel: "gemini-2.5-flash-lite",
  changelogPrompt: "",
  assistantShortcuts: [],
  assistantDefaultProvider: "claude-code",
  assistantDefaultModel: {},
  previewDefaultWidth: 1024,
  previewDefaultHeight: 768,
  previewAutoStart: false,
  previewCustomDevCommand: null,
  previewConsoleAutoOpen: true,
  previewLastUrls: {},
  taskBoardPlanningModel: "gemini-2.5-flash",
  taskBoardMaxTokens: 64000,
  taskBoardMaxRetries: 3,
  taskBoardAutoStartNext: true,
  taskBoardAutoOpenSlideOver: true,
  triviaEnabled: false,
  defaultContextWindow: 1000000,
  autoOpenFiles: false,
  claudeBinaryOverride: null,
  onboardingCompleted: false,
  apiKeyBannerDismissed: false,
  lastCloneDirectory: null,
  sessionLogsEnabled: true,
  codexDebugLoggingEnabled: true,
  sessionLogsRetentionDays: 30,
  superBroEnabled: true,
  superBroProvider: "auto",
  superBroModel: "auto",
  selfDriveProvider: "anthropic",
  selfDriveModel: "claude-haiku-4-5",
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
};

function resetStore(): void {
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: true,
  });
}

const mockOnBack = vi.fn();
const mockOnCloned = vi.fn();

function renderForm() {
  return render(<CloneForm onBack={mockOnBack} onCloned={mockOnCloned} />);
}

// ── Tests ──

describe("CloneForm", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // ── Rendering ──

  it("renders the form with all fields", () => {
    renderForm();
    expect(screen.getByPlaceholderText("https://github.com/user/repo")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("my-project")).toBeInTheDocument();
    expect(screen.getByText("Install dependencies after cloning")).toBeInTheDocument();
    expect(screen.getByText("Generate CLAUDE.md for AI-assisted development")).toBeInTheDocument();
    expect(screen.getByText("Clone & Open")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("renders Back button", () => {
    renderForm();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("has Clone & Open button disabled initially", () => {
    renderForm();
    expect(screen.getByText("Clone & Open")).toBeDisabled();
  });

  // ── URL Auto-detection ──

  it("auto-fills project name from GitHub HTTPS URL", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/my-project.git" },
    });
    const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;
    expect(nameInput.value).toBe("my-project");
  });

  it("auto-fills project name from GitHub URL without .git", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/cool-app" },
    });
    const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;
    expect(nameInput.value).toBe("cool-app");
  });

  it("auto-fills project name from SSH URL", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "git@github.com:user/ssh-project.git" },
    });
    const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;
    expect(nameInput.value).toBe("ssh-project");
  });

  it("does not overwrite manually edited project name", () => {
    renderForm();
    const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;
    // User manually types a name first
    fireEvent.change(nameInput, { target: { value: "custom-name" } });

    // Then URL is filled
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/different-name.git" },
    });

    expect(nameInput.value).toBe("custom-name");
  });

  // ── URL Validation ──

  it("shows error for invalid URL on blur", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, { target: { value: "not-a-url" } });
    fireEvent.blur(urlInput);
    expect(screen.getByText("Enter a valid Git repository URL")).toBeInTheDocument();
  });

  it("does not show error for valid HTTPS URL", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, { target: { value: "https://github.com/user/repo" } });
    fireEvent.blur(urlInput);
    expect(screen.queryByText("Enter a valid Git repository URL")).not.toBeInTheDocument();
  });

  it("does not show error for valid SSH URL", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, { target: { value: "git@github.com:user/repo.git" } });
    fireEvent.blur(urlInput);
    expect(screen.queryByText("Enter a valid Git repository URL")).not.toBeInTheDocument();
  });

  // ── Name Validation ──

  it("shows error for invalid project name", () => {
    renderForm();
    const nameInput = screen.getByPlaceholderText("my-project");
    fireEvent.change(nameInput, { target: { value: "-invalid" } });
    expect(
      screen.getByText("Must start with alphanumeric, only letters/numbers/hyphens/underscores/dots")
    ).toBeInTheDocument();
  });

  it("accepts valid project names", () => {
    renderForm();
    const nameInput = screen.getByPlaceholderText("my-project");
    fireEvent.change(nameInput, { target: { value: "my-project-123" } });
    expect(
      screen.queryByText("Must start with alphanumeric, only letters/numbers/hyphens/underscores/dots")
    ).not.toBeInTheDocument();
  });

  // ── Button states ──

  it("enables Clone & Open when form is valid", () => {
    renderForm();
    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    // Project name auto-fills, clone dir defaults
    // Need to set cloneTo
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test/Projects" } });

    expect(screen.getByText("Clone & Open")).not.toBeDisabled();
  });

  // ── Back / Cancel ──

  it("calls onBack when Back is clicked", () => {
    renderForm();
    fireEvent.click(screen.getByText("Back"));
    expect(mockOnBack).toHaveBeenCalled();
  });

  it("calls onBack when Cancel is clicked", () => {
    renderForm();
    fireEvent.click(screen.getByText("Cancel"));
    expect(mockOnBack).toHaveBeenCalled();
  });

  // ── Checkboxes ──

  it("has install deps checked by default", () => {
    renderForm();
    const checkbox = screen.getByText("Install dependencies after cloning").closest("label")!.querySelector("input")!;
    expect(checkbox.checked).toBe(true);
  });

  it("has generate CLAUDE.md checked by default", () => {
    renderForm();
    const checkbox = screen.getByText("Generate CLAUDE.md for AI-assisted development").closest("label")!.querySelector("input")!;
    expect(checkbox.checked).toBe(true);
  });

  it("can toggle checkboxes", () => {
    renderForm();
    const installCheckbox = screen.getByText("Install dependencies after cloning").closest("label")!.querySelector("input")!;
    fireEvent.click(installCheckbox);
    expect(installCheckbox.checked).toBe(false);
  });

  // ── Clone submission ──

  it("calls cloneFromGit with correct params", async () => {
    mockCloneFromGit.mockResolvedValue({
      project_path: "/Users/test/Projects/my-repo",
      project_name: "my-repo",
      template_id: "git-clone",
      warnings: [],
    });

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/my-repo" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test/Projects" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(mockCloneFromGit).toHaveBeenCalledWith(
        "https://github.com/user/my-repo.git", // auto-appends .git
        "/Users/test/Projects",
        "my-repo",
        true,  // installDeps
        true,  // generateClaudeMd
      );
    });
  });

  it("does not append .git to URLs that already have it", async () => {
    mockCloneFromGit.mockResolvedValue({
      project_path: "/Users/test/Projects/repo",
      project_name: "repo",
      template_id: "git-clone",
      warnings: [],
    });

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(mockCloneFromGit).toHaveBeenCalledWith(
        "https://github.com/user/repo.git",
        "/Users/test",
        "repo",
        true,
        true,
      );
    });
  });

  it("does not append .git to SSH URLs", async () => {
    mockCloneFromGit.mockResolvedValue({
      project_path: "/Users/test/repo",
      project_name: "repo",
      template_id: "git-clone",
      warnings: [],
    });

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "git@github.com:user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(mockCloneFromGit).toHaveBeenCalledWith(
        "git@github.com:user/repo.git",
        "/Users/test",
        "repo",
        true,
        true,
      );
    });
  });

  // ── Progress view ──

  it("shows progress view during cloning", async () => {
    mockCloneFromGit.mockReturnValue(new Promise(() => {})); // never resolves

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/tmp/test" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText("Cloning: repo")).toBeInTheDocument();
      expect(screen.getByText("Cloning repository")).toBeInTheDocument();
      expect(screen.getByText("Installing dependencies")).toBeInTheDocument();
      expect(screen.getByText("Generating CLAUDE.md")).toBeInTheDocument();
    });
  });

  // ── Settings persistence ──

  it("uses lastCloneDirectory from settings", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, lastCloneDirectory: "/Users/test/Dev" },
      loaded: true,
    });

    renderForm();

    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    expect(dirInput.value).toBe("/Users/test/Dev");
  });

  it("shows destination path preview", () => {
    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/my-app.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test/Projects" } });

    expect(screen.getByText("/Users/test/Projects/my-app/")).toBeInTheDocument();
  });

  // ── Error handling ──

  it("shows error when clone fails", async () => {
    mockCloneFromGit.mockRejectedValue("Repository not found");

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/tmp" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText("Repository not found")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("returns to form on Retry after error", async () => {
    mockCloneFromGit.mockRejectedValue("Failed");

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/tmp" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Retry"));

    // Back to form
    await waitFor(() => {
      expect(screen.getByPlaceholderText("https://github.com/user/repo")).toBeInTheDocument();
    });
  });

  // ── Success ──

  it("shows Open in CodeMantis on success", async () => {
    mockCloneFromGit.mockResolvedValue({
      project_path: "/Users/test/Projects/repo",
      project_name: "repo",
      template_id: "git-clone",
      warnings: [],
    });

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test/Projects" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText("Open in CodeMantis")).toBeInTheDocument();
    });
  });

  it("calls onCloned when Open in CodeMantis is clicked", async () => {
    mockCloneFromGit.mockResolvedValue({
      project_path: "/Users/test/Projects/repo",
      project_name: "repo",
      template_id: "git-clone",
      warnings: [],
    });

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test/Projects" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText("Open in CodeMantis")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Open in CodeMantis"));
    expect(mockOnCloned).toHaveBeenCalledWith("/Users/test/Projects/repo");
  });

  // ── onBusyChange callback ──

  it("calls onBusyChange(true) when cloning starts", async () => {
    mockCloneFromGit.mockReturnValue(new Promise(() => {})); // never resolves
    const onBusyChange = vi.fn();
    render(<CloneForm onBack={mockOnBack} onCloned={mockOnCloned} onBusyChange={onBusyChange} />);

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, { target: { value: "https://github.com/user/repo.git" } });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/tmp/test" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(onBusyChange).toHaveBeenCalledWith(true);
    });
  });

  it("does not call onBusyChange when prop is not provided", async () => {
    mockCloneFromGit.mockReturnValue(new Promise(() => {}));
    // Should render and clone without errors when onBusyChange is omitted
    render(<CloneForm onBack={mockOnBack} onCloned={mockOnCloned} />);

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, { target: { value: "https://github.com/user/repo.git" } });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/tmp/test" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText(/Cloning:/)).toBeInTheDocument();
    });
  });

  it("shows warnings on clone with warnings", async () => {
    mockCloneFromGit.mockResolvedValue({
      project_path: "/Users/test/Projects/repo",
      project_name: "repo",
      template_id: "git-clone",
      warnings: ["Dependencies not installed", "CLAUDE.md already exists"],
    });

    renderForm();

    const urlInput = screen.getByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(urlInput, {
      target: { value: "https://github.com/user/repo.git" },
    });
    const dirInput = screen.getByPlaceholderText("~/Projects") as HTMLInputElement;
    fireEvent.change(dirInput, { target: { value: "/Users/test/Projects" } });

    fireEvent.click(screen.getByText("Clone & Open"));

    await waitFor(() => {
      expect(screen.getByText("2 warnings")).toBeInTheDocument();
      expect(screen.getByText("Dependencies not installed")).toBeInTheDocument();
      expect(screen.getByText("CLAUDE.md already exists")).toBeInTheDocument();
    });
  });
});
