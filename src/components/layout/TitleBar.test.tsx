import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TitleBar from "./TitleBar";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { usePreviewStore } from "../../stores/previewStore";

const mockOpenPreview = vi.fn();
const mockTogglePreview = vi.fn();
const mockStartServer = vi.fn();

// Mock ProjectTab to simplify
vi.mock("./ProjectTab", () => ({
  default: ({ projectName, isActive }: { projectName: string; isActive: boolean }) => (
    <div data-testid={`tab-${projectName}`} data-active={isActive}>
      {projectName}
    </div>
  ),
}));

// Mock preview hooks
vi.mock("../../hooks/usePreviewWindow", () => ({
  usePreviewWindow: () => ({
    openPreview: mockOpenPreview,
    closePreview: vi.fn(),
    togglePreview: mockTogglePreview,
    navigateTo: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../../hooks/usePreviewServer", () => ({
  usePreviewServer: () => ({
    startServer: mockStartServer,
    stopServer: vi.fn(),
    checkStatus: vi.fn(),
  }),
}));

function setupProjectState(): void {
  useSessionStore.setState({
    projectOrder: ["/tmp/my-app"],
    activeProjectPath: "/tmp/my-app",
    sessions: new Map([
      [
        "s1",
        {
          id: "s1",
          name: "Test",
          project_path: "/tmp/my-app",
          status: "connected",
          created_at: "",
          model: null,
          icon_index: 0,
        },
      ],
    ]),
    tabOrder: ["s1"],
  });
}

describe("TitleBar", () => {
  const onCloseProject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      projectOrder: [],
      activeProjectPath: null,
      sessions: new Map(),
      tabOrder: [],
    });
    useUiStore.setState({
      showProjectPicker: false,
      projectPickerTab: "templates",
      showMcpModal: false,
      showSettingsModal: false,
    });
    usePreviewStore.setState({
      devServer: new Map(),
      previewOpen: new Map(),
      consoleLogs: new Map(),
      consoleDrawerOpen: false,
      viewportPreset: "desktop",
      unreadErrors: new Map(),
    });
  });

  it("renders CodeMantis label when no projects", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    expect(screen.getByText("CodeMantis")).toBeInTheDocument();
  });

  it("renders the + button for new project", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    const newBtn = screen.getByTitle(/New project from template/);
    expect(newBtn).toBeInTheDocument();
  });

  it("renders the Open button", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    const openBtn = screen.getByTitle(/Open existing project/);
    expect(openBtn).toBeInTheDocument();
  });

  it("opens project picker on Templates tab when + is clicked", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/New project from template/));
    const state = useUiStore.getState();
    expect(state.showProjectPicker).toBe(true);
    expect(state.projectPickerTab).toBe("templates");
  });

  it("opens project picker on Open tab when folder icon is clicked", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Open existing project/));
    const state = useUiStore.getState();
    expect(state.showProjectPicker).toBe(true);
    expect(state.projectPickerTab).toBe("open");
  });

  it("opens MCP modal when MCP button is clicked", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/MCP Servers/));
    expect(useUiStore.getState().showMcpModal).toBe(true);
  });

  it("opens Settings modal when settings button is clicked", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Settings/));
    expect(useUiStore.getState().showSettingsModal).toBe(true);
  });

  it("renders project tabs when projects exist", () => {
    useSessionStore.setState({
      projectOrder: ["/tmp/project-a"],
      activeProjectPath: "/tmp/project-a",
      sessions: new Map([["s1", { id: "s1", name: "Test", project_path: "/tmp/project-a", status: "connected", created_at: "", model: null, icon_index: 0 }]]),
      tabOrder: ["s1"],
    });
    render(<TitleBar onCloseProject={onCloseProject} />);
    expect(screen.getByTestId("tab-project-a")).toBeInTheDocument();
    expect(screen.queryByText("CodeMantis")).not.toBeInTheDocument();
  });

  // --- Globe button / Preview ---

  it("renders the Run Application (Globe) button", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    expect(screen.getByTitle(/Run Application/)).toBeInTheDocument();
  });

  it("Globe click with no active project does nothing", () => {
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));
    // No URL input should appear because activeProjectPath is null
    expect(screen.queryByText("Preview URL")).not.toBeInTheDocument();
    expect(mockOpenPreview).not.toHaveBeenCalled();
    expect(mockStartServer).not.toHaveBeenCalled();
  });

  it("Globe click with active project and no dev server shows URL input", () => {
    setupProjectState();
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));
    expect(screen.getByText("Preview URL")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("http://localhost:3000")).toBeInTheDocument();
    expect(screen.getByText("Open URL")).toBeInTheDocument();
    expect(screen.getByText("Start Dev Server")).toBeInTheDocument();
  });

  it("submitting URL input calls openPreview with the URL", () => {
    setupProjectState();
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));

    const input = screen.getByPlaceholderText("http://localhost:3000");
    fireEvent.change(input, { target: { value: "http://localhost:5173" } });
    fireEvent.click(screen.getByText("Open URL"));

    expect(mockOpenPreview).toHaveBeenCalledWith("http://localhost:5173");
    // URL input should be closed
    expect(screen.queryByText("Preview URL")).not.toBeInTheDocument();
  });

  it("clicking Start Dev Server calls startServer and closes input", () => {
    setupProjectState();
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));
    fireEvent.click(screen.getByText("Start Dev Server"));

    expect(mockStartServer).toHaveBeenCalled();
    expect(screen.queryByText("Preview URL")).not.toBeInTheDocument();
  });

  it("Escape key closes URL input popup", () => {
    setupProjectState();
    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));
    expect(screen.getByText("Preview URL")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("http://localhost:3000");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Preview URL")).not.toBeInTheDocument();
  });

  it("Globe click with running dev server and closed preview calls openPreview", () => {
    setupProjectState();
    usePreviewStore.setState({
      devServer: new Map([
        [
          "/tmp/my-app",
          {
            terminalId: "t1",
            sessionId: "devserver-abc",
            port: 3000,
            url: "http://localhost:3000",
            status: "running",
          },
        ],
      ]),
      previewOpen: new Map([["/tmp/my-app", false]]),
    });

    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));

    expect(mockOpenPreview).toHaveBeenCalledWith("http://localhost:3000");
    expect(screen.queryByText("Preview URL")).not.toBeInTheDocument();
  });

  it("Globe click with running dev server and open preview calls togglePreview", () => {
    setupProjectState();
    usePreviewStore.setState({
      devServer: new Map([
        [
          "/tmp/my-app",
          {
            terminalId: "t1",
            sessionId: "devserver-abc",
            port: 3000,
            url: "http://localhost:3000",
            status: "running",
          },
        ],
      ]),
      previewOpen: new Map([["/tmp/my-app", true]]),
    });

    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));

    expect(mockTogglePreview).toHaveBeenCalled();
    expect(mockOpenPreview).not.toHaveBeenCalled();
  });

  it("Globe click while server is starting does nothing", () => {
    setupProjectState();
    usePreviewStore.setState({
      devServer: new Map([
        [
          "/tmp/my-app",
          {
            terminalId: "t1",
            sessionId: "devserver-abc",
            port: null,
            url: null,
            status: "starting",
          },
        ],
      ]),
    });

    render(<TitleBar onCloseProject={onCloseProject} />);
    fireEvent.click(screen.getByTitle(/Run Application/));

    expect(mockOpenPreview).not.toHaveBeenCalled();
    expect(mockTogglePreview).not.toHaveBeenCalled();
    expect(mockStartServer).not.toHaveBeenCalled();
    expect(screen.queryByText("Preview URL")).not.toBeInTheDocument();
  });

  it("Globe button has green pulse class when server is running", () => {
    setupProjectState();
    usePreviewStore.setState({
      devServer: new Map([
        [
          "/tmp/my-app",
          {
            terminalId: "t1",
            sessionId: "devserver-abc",
            port: 3000,
            url: "http://localhost:3000",
            status: "running",
          },
        ],
      ]),
    });

    render(<TitleBar onCloseProject={onCloseProject} />);
    const btn = screen.getByTitle(/Run Application/);
    expect(btn.className).toContain("text-green-400");
    expect(btn.className).toContain("animate-pulse");
  });

  it("Globe button has yellow class when server is starting", () => {
    setupProjectState();
    usePreviewStore.setState({
      devServer: new Map([
        [
          "/tmp/my-app",
          {
            terminalId: "t1",
            sessionId: "devserver-abc",
            port: null,
            url: null,
            status: "scanning",
          },
        ],
      ]),
    });

    render(<TitleBar onCloseProject={onCloseProject} />);
    const btn = screen.getByTitle(/Run Application/);
    expect(btn.className).toContain("text-yellow-400");
  });

  it("Globe button has red class when server has error", () => {
    setupProjectState();
    usePreviewStore.setState({
      devServer: new Map([
        [
          "/tmp/my-app",
          {
            terminalId: "t1",
            sessionId: "devserver-abc",
            port: null,
            url: null,
            status: "error",
            errorMessage: "Failed to detect port",
          },
        ],
      ]),
    });

    render(<TitleBar onCloseProject={onCloseProject} />);
    const btn = screen.getByTitle(/Run Application/);
    expect(btn.className).toContain("text-red-400");
  });

  it("Globe button has dim (idle) class when no server", () => {
    setupProjectState();
    render(<TitleBar onCloseProject={onCloseProject} />);
    const btn = screen.getByTitle(/Run Application/);
    expect(btn.className).toContain("text-text-ghost");
  });
});
