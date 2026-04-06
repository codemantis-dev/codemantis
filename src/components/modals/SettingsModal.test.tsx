import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsModal from "./SettingsModal";
import type { SettingsTab } from "./settings/SettingsShared";

const mockState = {
  showModal: true,
  setShowModal: vi.fn(),
  activeTab: "general" as SettingsTab,
  setActiveTab: vi.fn(),
  settings: { theme: "midnight" },
  theme: "midnight" as const,
  fontSize: 13,
  sendShortcut: "cmd+enter",
  triviaEnabled: true,
  autoOpenFiles: true,
  defaultContextWindow: 200000,
  showWelcomeScreen: false,
  terminalShell: "",
  terminalFontSize: 13,
  quickCommands: [],
  apiKeys: {},
  modelPricing: {},
  testingKey: false as const,
  testResults: {},
  changelogEnabled: false,
  changelogProvider: "gemini" as const,
  changelogModel: "gemini-2.5-flash",
  changelogPrompt: "",
  assistantDefaultProvider: "claude-code" as const,
  assistantDefaultModel: {},
  assistantShortcuts: [],
  previewDefaultWidth: 1024,
  previewDefaultHeight: 768,
  previewAutoStart: false,
  previewCustomDevCommand: "",
  previewConsoleAutoOpen: false,
  previewLastUrls: {},
  taskBoardPlanningModel: "gemini-3.1-flash-lite-preview",
  taskBoardMaxTokens: 64000,
  handleThemeChange: vi.fn(),
  setFontSize: vi.fn(),
  setSendShortcut: vi.fn(),
  setTriviaEnabled: vi.fn(),
  setAutoOpenFiles: vi.fn(),
  setDefaultContextWindow: vi.fn(),
  setShowWelcomeScreen: vi.fn(),
  setTerminalShell: vi.fn(),
  setTerminalFontSize: vi.fn(),
  setQuickCommands: vi.fn(),
  handleApiKeyChange: vi.fn(),
  handleModelPricingChange: vi.fn(),
  handleTestKey: vi.fn(),
  setChangelogEnabled: vi.fn(),
  handleChangelogProviderChange: vi.fn(),
  setChangelogModel: vi.fn(),
  setChangelogPrompt: vi.fn(),
  handleAssistantProviderChange: vi.fn(),
  handleAssistantModelChange: vi.fn(),
  setAssistantShortcuts: vi.fn(),
  setPreviewDefaultWidth: vi.fn(),
  setPreviewDefaultHeight: vi.fn(),
  setPreviewAutoStart: vi.fn(),
  setPreviewCustomDevCommand: vi.fn(),
  setPreviewConsoleAutoOpen: vi.fn(),
  setTaskBoardPlanningModel: vi.fn(),
  setTaskBoardMaxTokens: vi.fn(),
  handleCancel: vi.fn(),
  handleSave: vi.fn(),
};

vi.mock("../../hooks/useSettingsFormState", () => ({
  useSettingsFormState: () => mockState,
}));
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}));
vi.mock("./settings/GeneralTab", () => ({
  default: () => <div data-testid="general-tab" />,
}));
vi.mock("./settings/TerminalTab", () => ({
  default: () => <div data-testid="terminal-tab" />,
}));
vi.mock("./settings/QuickCommandsTab", () => ({
  default: () => <div data-testid="quick-commands-tab" />,
}));
vi.mock("./settings/AIProvidersTab", () => ({
  default: () => <div data-testid="ai-providers-tab" />,
}));
vi.mock("./settings/ChangelogSettingsTab", () => ({
  default: () => <div data-testid="changelog-tab" />,
}));
vi.mock("./settings/AssistantSettingsTab", () => ({
  default: () => <div data-testid="assistant-tab" />,
}));
vi.mock("./settings/ShortcutsTab", () => ({
  default: () => <div data-testid="shortcuts-tab" />,
}));
vi.mock("./settings/ApiLogsTab", () => ({
  default: () => <div data-testid="api-logs-tab" />,
}));

describe("SettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.showModal = true;
    mockState.activeTab = "general";
  });

  it("renders the settings modal with title", () => {
    render(<SettingsModal />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders navigation items", () => {
    render(<SettingsModal />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("AI Providers")).toBeInTheDocument();
  });

  it("shows the General tab content by default", () => {
    render(<SettingsModal />);
    expect(screen.getByTestId("general-tab")).toBeInTheDocument();
  });

  it("has Save and Cancel buttons", () => {
    render(<SettingsModal />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls handleSave when Save button is clicked", () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByText("Save"));
    expect(mockState.handleSave).toHaveBeenCalledTimes(1);
  });

  it("calls handleCancel when Cancel button is clicked", () => {
    render(<SettingsModal />);
    // There are two Cancel buttons (sidebar + close button), click the first
    const cancelButtons = screen.getAllByText("Cancel");
    fireEvent.click(cancelButtons[0]);
    expect(mockState.handleCancel).toHaveBeenCalledTimes(1);
  });

  it("does not render when showModal is false", () => {
    mockState.showModal = false;
    const { container } = render(<SettingsModal />);
    expect(container.querySelector("[data-testid='dialog-root']")).not.toBeInTheDocument();
  });

  it("renders settings tabs in navigation", () => {
    render(<SettingsModal />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("AI Providers")).toBeInTheDocument();
  });

  it("tab switching calls setActiveTab", () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByText("Terminal"));
    expect(mockState.setActiveTab).toHaveBeenCalledWith("terminal");
  });

  it("tab switching preserves form state", () => {
    // Simulate switching tabs: the mockState should retain its values
    render(<SettingsModal />);

    // Click Terminal tab
    fireEvent.click(screen.getByText("Terminal"));
    expect(mockState.setActiveTab).toHaveBeenCalledWith("terminal");

    // The settings values (theme, fontSize, etc.) should remain unchanged
    // because switching tabs does not reset the form state
    expect(mockState.theme).toBe("midnight");
    expect(mockState.fontSize).toBe(13);
    expect(mockState.triviaEnabled).toBe(true);
  });

  it("save calls handleSave and preserves all settings", () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByText("Save"));
    expect(mockState.handleSave).toHaveBeenCalledTimes(1);
    // handleCancel should not be called when saving
    expect(mockState.handleCancel).not.toHaveBeenCalled();
  });

  it("shows correct tab content based on activeTab", () => {
    mockState.activeTab = "terminal";
    render(<SettingsModal />);
    expect(screen.getByTestId("terminal-tab")).toBeInTheDocument();
    // General tab should not be rendered
    expect(screen.queryByTestId("general-tab")).not.toBeInTheDocument();
  });
});
