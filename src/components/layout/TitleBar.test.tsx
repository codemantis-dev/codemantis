import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TitleBar from "./TitleBar";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

// Mock ProjectTab to simplify
vi.mock("./ProjectTab", () => ({
  default: ({ projectName, isActive }: { projectName: string; isActive: boolean }) => (
    <div data-testid={`tab-${projectName}`} data-active={isActive}>
      {projectName}
    </div>
  ),
}));

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
});
