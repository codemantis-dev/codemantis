import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import * as React from "react";
import PreviewUrlDialog from "./PreviewUrlDialog";
import { usePreviewStore } from "../../stores/previewStore";
import { useSettingsStore } from "../../stores/settingsStore";

const mockOpenPreviewWindow = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock("../../lib/tauri-commands", () => ({
  openPreviewWindow: (...args: unknown[]) => mockOpenPreviewWindow(...args),
  getSettings: vi.fn(() => Promise.resolve({})),
  updateSettings: vi.fn(() => Promise.resolve()),
}));

// Mock Radix Dialog portal to render inline
vi.mock("@radix-ui/react-dialog", () => {
  return {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open !== false ? children : null,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "dialog-overlay" }, children),
    Content: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "dialog-content" }, children),
    Title: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
    Description: ({ children }: { children: React.ReactNode }) =>
      React.createElement("p", null, children),
  };
});

const PROJECT = "/tmp/my-project";

function resetStores(): void {
  usePreviewStore.setState({
    devServer: new Map(),
    previewOpen: new Map(),
    consoleLogs: new Map(),
    consoleDrawerOpen: false,
    viewportPreset: "desktop",
    unreadErrors: new Map(),
    previewUrlPrompt: null,
  });
}

describe("PreviewUrlDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    // Reset settings store to ensure no last-used URLs leak between tests
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        previewLastUrls: {},
      },
    });
  });

  it("does not render when previewUrlPrompt is null", () => {
    const { container } = render(<PreviewUrlDialog />);
    expect(container.innerHTML).toBe("");
  });

  it("renders when previewUrlPrompt is set", () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Could not detect dev server port.",
    });
    render(<PreviewUrlDialog />);
    expect(screen.getByText("Dev server failed")).toBeTruthy();
    expect(screen.getByText("Could not detect dev server port.")).toBeTruthy();
    expect(screen.getByPlaceholderText("http://localhost:3000")).toBeTruthy();
  });

  it("pre-fills with last-used URL from settings", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        previewLastUrls: { [PROJECT]: "http://localhost:8080" },
      },
    });
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);
    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    expect(input.value).toBe("http://localhost:8080");
  });

  it("pre-fills empty when no last-used URL exists", () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);
    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("Cancel button clears the prompt", () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(usePreviewStore.getState().previewUrlPrompt).toBeNull();
  });

  it("Open Preview button calls openPreviewWindow with the URL", async () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:4000" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Preview"));
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "http://localhost:4000",
      "my-project",
      PROJECT,
    );
    expect(usePreviewStore.getState().previewOpen.get(PROJECT)).toBe(true);
    expect(usePreviewStore.getState().previewUrlPrompt).toBeNull();
  });

  it("auto-adds http:// when missing", async () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "localhost:9000" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Preview"));
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "http://localhost:9000",
      "my-project",
      PROJECT,
    );
  });

  it("preserves https:// when present", async () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://dev.example.com:3000" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Preview"));
    });

    expect(mockOpenPreviewWindow).toHaveBeenCalledWith(
      "https://dev.example.com:3000",
      "my-project",
      PROJECT,
    );
  });

  it("saves URL to previewLastUrls after successful open", async () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:5000" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Preview"));
    });

    const lastUrls = useSettingsStore.getState().settings.previewLastUrls;
    expect(lastUrls[PROJECT]).toBe("http://localhost:5000");
  });

  it("Open Preview button is disabled when input is empty", () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const button = screen.getByText("Open Preview") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("Open Preview button is enabled when input has text", () => {
    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:3000" } });

    const button = screen.getByText("Open Preview") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("handles openPreviewWindow error gracefully", async () => {
    mockOpenPreviewWindow.mockRejectedValueOnce(new Error("Failed to create window"));

    usePreviewStore.getState().setPreviewUrlPrompt({
      projectPath: PROJECT,
      errorMessage: "Error",
    });
    render(<PreviewUrlDialog />);

    const input = screen.getByPlaceholderText("http://localhost:3000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:3000" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Preview"));
    });

    // Preview should not remain marked as open on error
    expect(usePreviewStore.getState().previewOpen.get(PROJECT)).toBe(false);
    // Dialog should still close
    expect(usePreviewStore.getState().previewUrlPrompt).toBeNull();
  });
});
