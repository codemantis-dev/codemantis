import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GuideSessionCard from "./GuideSessionCard";
import type { GuideSession } from "../../types/implementation-guide";

// Mock stores used inside the component
vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

const mockSetDraftInput = vi.fn();

vi.mock("../../stores/uiStore", () => ({
  useUiStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ rightTab: "guide", setRightTab: vi.fn(), setDraftInput: mockSetDraftInput }),
    ),
    {
      getState: vi.fn(() => ({
        setDraftInput: mockSetDraftInput,
        setRightTab: vi.fn(),
      })),
    },
  ),
}));

vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ activeSessionId: "session-1" }),
    ),
    {
      getState: vi.fn(() => ({
        activeSessionId: "session-1",
      })),
    },
  ),
}));

function makeSession(overrides: Partial<GuideSession> = {}): GuideSession {
  return {
    index: 1,
    name: "Foundation",
    scope: "Phase 1",
    readSections: "Sections 1, 2",
    files: ["src/db.ts", "src/models.ts"],
    prompt: "Build the foundation layer.",
    verifyChecks: [
      { id: "v-1-0", label: "TypeScript compiles", checked: false },
      { id: "v-1-1", label: "Tests pass", checked: false },
    ],
    status: "active",
    ...overrides,
  };
}

describe("GuideSessionCard", () => {
  const onToggle = vi.fn();
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders active session expanded with CURRENT badge", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    expect(screen.getByText("CURRENT")).toBeTruthy();
    expect(screen.getByText("Session 1: Foundation")).toBeTruthy();
    expect(screen.getByText("Copy Prompt")).toBeTruthy();
    expect(screen.getByText("Send to Chat")).toBeTruthy();
  });

  it("renders pending session collapsed", () => {
    render(
      <GuideSessionCard
        session={makeSession({ status: "pending" })}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    expect(screen.getByText("Session 1: Foundation")).toBeTruthy();
    // Should NOT show action buttons since it collapses by default for pending
    expect(screen.queryByText("Copy Prompt")).toBeNull();
  });

  it("renders done session with 'All checks passed'", () => {
    render(
      <GuideSessionCard
        session={makeSession({
          status: "done",
          verifyChecks: [
            { id: "v-1-0", label: "TypeScript compiles", checked: true },
            { id: "v-1-1", label: "Tests pass", checked: true },
          ],
        })}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    expect(screen.getByText("All checks passed")).toBeTruthy();
  });

  it("expands pending session on header click", () => {
    render(
      <GuideSessionCard
        session={makeSession({ status: "pending" })}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    // Click header to expand
    fireEvent.click(screen.getByText("Session 1: Foundation"));
    expect(screen.getByText("Copy Prompt")).toBeTruthy();
  });

  it("copies prompt to clipboard on Copy Prompt click", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByText("Copy Prompt"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Build the foundation layer.");
  });

  it("calls onToggleVerifyCheck when checkbox clicked", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith("v-1-0");
  });

  it("disables Mark Complete when not all checks are done", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    const btn = screen.getByText(/0\/2 checks/);
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Mark Complete when all checks are done", () => {
    render(
      <GuideSessionCard
        session={makeSession({
          verifyChecks: [
            { id: "v-1-0", label: "TypeScript compiles", checked: true },
            { id: "v-1-1", label: "Tests pass", checked: true },
          ],
        })}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    const btn = screen.getByText("Mark Session Complete");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows file count and expands file list on click", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    const filesBtn = screen.getByText("2 files");
    expect(filesBtn).toBeTruthy();
    fireEvent.click(filesBtn);
    expect(screen.getByText("src/db.ts")).toBeTruthy();
    expect(screen.getByText("src/models.ts")).toBeTruthy();
  });

  it("renders 'Verify for me' button for active session with verify checks", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    expect(screen.getByText("Verify for me")).toBeTruthy();
  });

  it("does not render 'Verify for me' for pending sessions", () => {
    render(
      <GuideSessionCard
        session={makeSession({ status: "pending" })}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    // Expand to see content
    fireEvent.click(screen.getByText("Session 1: Foundation"));
    expect(screen.queryByText("Verify for me")).toBeNull();
  });

  it("does not render 'Verify for me' when no verify checks", () => {
    render(
      <GuideSessionCard
        session={makeSession({ verifyChecks: [] })}
        specFilename="test.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    expect(screen.queryByText("Verify for me")).toBeNull();
  });

  it("calls setDraftInput with verification prompt on 'Verify for me' click", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="my-feature.md"
        auditFilename={null}
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByText("Verify for me"));
    expect(mockSetDraftInput).toHaveBeenCalledOnce();
    const prompt = mockSetDraftInput.mock.calls[0][0] as string;
    expect(prompt).toContain("Session 1: Foundation");
    expect(prompt).toContain("docs/specs/my-feature.md");
    expect(prompt).toContain("TypeScript compiles");
    expect(prompt).toContain("Tests pass");
    expect(prompt).not.toContain("Verification Audit");
  });

  it("includes audit document reference in verify prompt when auditFilename is provided", () => {
    render(
      <GuideSessionCard
        session={makeSession()}
        specFilename="my-feature.md"
        auditFilename="my-feature-audit.md"
        onToggleVerifyCheck={onToggle}
        onMarkComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByText("Verify for me"));
    expect(mockSetDraftInput).toHaveBeenCalledOnce();
    const prompt = mockSetDraftInput.mock.calls[0][0] as string;
    expect(prompt).toContain("docs/specs/my-feature-audit.md");
    expect(prompt).toContain("Verification Audit");
  });
});
