import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GuidePanel from "./GuidePanel";
import { useGuideStore } from "../../stores/guideStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { ImplementationGuide } from "../../types/implementation-guide";

vi.mock("../../lib/tauri-commands", () => ({
  saveGuide: vi.fn().mockResolvedValue("guide-1"),
  loadGuide: vi.fn().mockResolvedValue(null),
  updateGuideData: vi.fn().mockResolvedValue(undefined),
  deleteGuide: vi.fn().mockResolvedValue(undefined),
  deleteGuidesForProject: vi.fn().mockResolvedValue(undefined),
  readSpecDocument: vi.fn().mockResolvedValue("# Spec content"),
}));

// Prevent the useEffect from calling loadGuideForProject and overriding test state
const noopLoad = vi.fn();

function makeGuide(): ImplementationGuide {
  return {
    id: "guide-1",
    projectPath: "/test",
    specFilename: "test.md",
    auditFilename: null,
    title: "My Test App",
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "1, 2",
        files: ["src/db.ts"],
        prompt: "Build foundation.",
        verifyChecks: [
          { id: "v-1-0", label: "TS compiles", checked: true },
          { id: "v-1-1", label: "Tests pass", checked: true },
        ],
        status: "done",
      },
      {
        index: 2,
        name: "Features",
        scope: "Phase 2",
        readSections: "3, 4",
        files: ["src/api.ts"],
        prompt: "Build features.",
        verifyChecks: [
          { id: "v-2-0", label: "API works", checked: false },
        ],
        status: "active",
      },
      {
        index: 3,
        name: "Polish",
        scope: "Phase 3",
        readSections: "5",
        files: [],
        prompt: "Polish.",
        verifyChecks: [],
        status: "pending",
      },
    ],
    createdAt: "2026-03-01T00:00:00.000Z",
    status: "active",
  };
}

describe("GuidePanel", () => {
  beforeEach(() => {
    // Override loadGuideForProject with a no-op so the useEffect doesn't reset test state
    useGuideStore.setState({
      guide: null,
      loading: false,
      loadGuideForProject: noopLoad,
    });
    useSessionStore.setState({ activeProjectPath: "/test" } as never);
    vi.clearAllMocks();
  });

  it("renders empty state when no guide", () => {
    render(<GuidePanel />);
    expect(screen.getByText(/No implementation guide yet/)).toBeTruthy();
  });

  it("renders loading state", () => {
    useGuideStore.setState({ loading: true });
    render(<GuidePanel />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
  });

  it("renders guide with title, progress and session cards", () => {
    useGuideStore.setState({ guide: makeGuide() });
    render(<GuidePanel />);

    expect(screen.getByText("My Test App")).toBeTruthy();
    expect(screen.getByText(/1 of 3 sessions complete/)).toBeTruthy();
    expect(screen.getByText(/Session 1: Foundation/)).toBeTruthy();
    expect(screen.getByText(/Session 2: Features/)).toBeTruthy();
    expect(screen.getByText(/Session 3: Polish/)).toBeTruthy();
  });

  it("shows Open Spec and Dismiss buttons in footer", () => {
    useGuideStore.setState({ guide: makeGuide() });
    render(<GuidePanel />);

    expect(screen.getByText("Open Spec")).toBeTruthy();
    expect(screen.getByText("Dismiss")).toBeTruthy();
  });

  it("shows completed state text when all sessions done", () => {
    const guide = makeGuide();
    guide.status = "completed";
    guide.sessions.forEach((s) => {
      s.status = "done";
      s.verifyChecks.forEach((c) => (c.checked = true));
    });
    useGuideStore.setState({ guide });
    render(<GuidePanel />);

    expect(screen.getByText("Implementation Guide Complete")).toBeTruthy();
  });
});
