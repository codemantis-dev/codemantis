import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";
import SuperBroToggle from "./SuperBroToggle";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("../../stores/superBroStore", () => ({
  useSuperBroStore: vi.fn(),
}));
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: vi.fn(),
}));
vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: vi.fn(),
}));

import { useSuperBroStore } from "../../stores/superBroStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";

const mockSuperBroStore = useSuperBroStore as unknown as Mock;
const mockSettingsStore = useSettingsStore as unknown as Mock;
const mockSessionStore = useSessionStore as unknown as Mock;

const toggleMock = vi.fn();

function setupStores(overrides: {
  globalEnabled?: boolean;
  projectPath?: string | null;
  isEnabled?: boolean;
} = {}): void {
  const {
    globalEnabled = true,
    projectPath = "/test/project",
    isEnabled = true,
  } = overrides;

  mockSettingsStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ settings: { superBroEnabled: globalEnabled } }),
  );

  mockSessionStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeSessionId: projectPath ? "sess-1" : null,
      sessions: new Map(
        projectPath
          ? [["sess-1", { project_path: projectPath }]]
          : [],
      ),
    }),
  );

  mockSuperBroStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      enabledProjects: new Map(
        projectPath ? [[projectPath, isEnabled]] : [],
      ),
      toggle: toggleMock,
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────
describe("SuperBroToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when globalEnabled is false", () => {
    setupStores({ globalEnabled: false });
    const { container } = render(<SuperBroToggle />);
    expect(container.firstChild).toBeNull();
  });

  it("renders toggle button when enabled", () => {
    setupStores();
    render(<SuperBroToggle />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows accent color when project is enabled", () => {
    setupStores({ isEnabled: true });
    render(<SuperBroToggle />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("text-accent");
  });

  it("shows dimmed styling with strikethrough when disabled", () => {
    setupStores({ isEnabled: false });
    render(<SuperBroToggle />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("text-text-faint");
    expect(button.className).toContain("line-through");
  });

  it("shows green dot when enabled", () => {
    setupStores({ isEnabled: true });
    render(<SuperBroToggle />);
    const button = screen.getByRole("button");
    const dot = button.querySelector("span.rounded-full");
    expect(dot?.className).toContain("bg-green");
  });

  it("shows grey dot when disabled", () => {
    setupStores({ isEnabled: false });
    render(<SuperBroToggle />);
    const button = screen.getByRole("button");
    const dot = button.querySelector("span.rounded-full");
    expect(dot?.className).toContain("bg-text-ghost");
  });

  it("shows 'Bro' label text", () => {
    setupStores();
    render(<SuperBroToggle />);
    expect(screen.getByText("Bro")).toBeInTheDocument();
  });

  it("click calls toggle with projectPath", () => {
    setupStores({ projectPath: "/my/project" });
    render(<SuperBroToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(toggleMock).toHaveBeenCalledWith("/my/project");
  });
});
