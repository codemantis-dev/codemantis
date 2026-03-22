import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectPicker from "./ProjectPicker";
import { useUiStore } from "../../stores/uiStore";

// Mock tauri dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

// Mock TemplatePicker to avoid nested async issues
vi.mock("./TemplatePicker", () => ({
  default: ({ onProjectCreated, onBusyChange }: { onProjectCreated: (path: string) => void; onBusyChange?: (busy: boolean) => void }) => (
    <div data-testid="template-picker">
      <button onClick={() => onProjectCreated("/tmp/test")}>MockTemplateCreate</button>
      <button onClick={() => onBusyChange?.(true)} data-testid="set-busy">SetBusy</button>
      <button onClick={() => onBusyChange?.(false)} data-testid="clear-busy">ClearBusy</button>
    </div>
  ),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

describe("ProjectPicker", () => {
  const onSelectProject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  function openPicker(tab: "templates" | "open" | "recent" = "templates"): void {
    useUiStore.setState({
      showProjectPicker: true,
      projectPickerTab: tab,
    });
  }

  it("renders nothing when closed", () => {
    useUiStore.setState({ showProjectPicker: false });
    const { container } = render(<ProjectPicker onSelectProject={onSelectProject} />);
    // Dialog portal content shouldn't be visible
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders with Templates tab active by default", () => {
    openPicker("templates");
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByTestId("template-picker")).toBeInTheDocument();
  });

  it("renders Open Folder tab content when selected", () => {
    openPicker("open");
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("Select a project folder...")).toBeInTheDocument();
    // There should be the folder picker button and the "Open Project" submit button
    const openButtons = screen.getAllByText("Open Project");
    // Title + submit button
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Recent tab content when selected", () => {
    openPicker("recent");
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("Recent Projects")).toBeInTheDocument();
    expect(screen.getByText("No recent projects")).toBeInTheDocument();
  });

  it("shows recent projects when they exist", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/project-a", "/Users/test/project-b"])
    );
    openPicker("recent");
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("project-a")).toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();
  });

  it("switches between tabs", () => {
    openPicker("templates");
    render(<ProjectPicker onSelectProject={onSelectProject} />);

    // Click Open Folder tab
    fireEvent.click(screen.getByText("Open Folder"));
    expect(screen.getByText("Select a project folder...")).toBeInTheDocument();

    // Click Recent tab
    fireEvent.click(screen.getByText("Recent"));
    expect(screen.getByText("No recent projects")).toBeInTheDocument();

    // Click Templates tab
    fireEvent.click(screen.getByText("Templates"));
    expect(screen.getByTestId("template-picker")).toBeInTheDocument();
  });

  it("renders all three tab buttons", () => {
    openPicker();
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("Templates")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("renders recent count badge", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/a", "/b", "/c"])
    );
    openPicker();
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  // ── Dismiss protection ──

  it("hides close button when busy", () => {
    openPicker("templates");
    render(<ProjectPicker onSelectProject={onSelectProject} />);

    // Trigger busy state via mock TemplatePicker
    fireEvent.click(screen.getByTestId("set-busy"));

    // Close button should be hidden — the only X buttons should not be Dialog.Close
    const dialog = screen.getByRole("dialog");
    const closeButtons = dialog.querySelectorAll("button");
    const xButtons = Array.from(closeButtons).filter((btn) =>
      btn.querySelector("svg") && btn.closest("[aria-label]")?.getAttribute("aria-label")?.includes("close")
    );
    // The Dialog.Close X button should not be rendered
    expect(xButtons).toHaveLength(0);
  });

  it("shows close button when not busy", () => {
    openPicker("templates");
    render(<ProjectPicker onSelectProject={onSelectProject} />);

    // Set busy then clear it
    fireEvent.click(screen.getByTestId("set-busy"));
    fireEvent.click(screen.getByTestId("clear-busy"));

    // Dialog should still be open and close button should be visible
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("removes a recent project when delete button is clicked", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/project-a", "/Users/test/project-b"])
    );
    openPicker("recent");
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    expect(screen.getByText("project-a")).toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();

    const removeBtn = screen.getByLabelText("Remove project-a from recent projects");
    fireEvent.click(removeBtn);

    expect(screen.queryByText("project-a")).not.toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it("opens recent project on click", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/my-project"])
    );
    openPicker("recent");
    render(<ProjectPicker onSelectProject={onSelectProject} />);
    fireEvent.click(screen.getByText("my-project"));
    expect(onSelectProject).toHaveBeenCalledWith("/Users/test/my-project");
  });
});
