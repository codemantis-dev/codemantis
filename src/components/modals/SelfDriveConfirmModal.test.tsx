import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SelfDriveConfirmModal from "./SelfDriveConfirmModal";
import { useGuideStore } from "../../stores/guideStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { ImplementationGuide } from "../../types/implementation-guide";

// Mock Radix Dialog
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Close: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <button className={className}>{children}</button>
  ),
}));

function makeGuide(overrides?: Partial<ImplementationGuide>): ImplementationGuide {
  return {
    id: "g1",
    projectPath: "/tmp/project",
    specFilename: "spec.md",
    auditFilename: null,
    title: "Test Guide",
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
    sessions: [
      { index: 1, name: "Session 1", scope: "Setup", readSections: "", files: [], prompt: "Do X", verifyChecks: [], status: "done" },
      { index: 2, name: "Session 2", scope: "Build", readSections: "", files: [], prompt: "Do Y", verifyChecks: [], status: "pending" },
      { index: 3, name: "Session 3", scope: "Polish", readSections: "", files: [], prompt: "Do Z", verifyChecks: [], status: "pending" },
    ],
    ...overrides,
  };
}

describe("SelfDriveConfirmModal", () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useGuideStore.setState({ guide: null });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionModes: new Map([["s1", "normal"]]),
    });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        selfDriveProvider: "anthropic",
        selfDriveModel: "claude-haiku-4-5",
        selfDriveMaxFixAttempts: 3,
        selfDriveRunBuildCheck: true,
        selfDriveRunTests: true,
        apiKeys: { anthropic: "sk-test-key" },
      },
    });
  });

  it("renders nothing when guide is null", () => {
    const { container } = render(
      <SelfDriveConfirmModal open={true} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders when open and guide is present", () => {
    useGuideStore.setState({ guide: makeGuide() });

    render(
      <SelfDriveConfirmModal open={true} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByText("Start Self-Drive?")).toBeInTheDocument();
  });

  it("shows remaining session count from guide", () => {
    useGuideStore.setState({ guide: makeGuide() });

    render(
      <SelfDriveConfirmModal open={true} onClose={onClose} onConfirm={onConfirm} />,
    );
    // 2 remaining (session 2 and 3 are pending; session 1 is done)
    expect(screen.getByText("2 remaining sessions")).toBeInTheDocument();
  });

  it("shows provider and model label", () => {
    useGuideStore.setState({ guide: makeGuide() });

    render(
      <SelfDriveConfirmModal open={true} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument();
  });

  it("confirm button calls onConfirm", () => {
    useGuideStore.setState({ guide: makeGuide() });

    render(
      <SelfDriveConfirmModal open={true} onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText("Start Self-Drive"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel button calls onClose", () => {
    useGuideStore.setState({ guide: makeGuide() });

    render(
      <SelfDriveConfirmModal open={true} onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when open is false", () => {
    useGuideStore.setState({ guide: makeGuide() });

    const { container } = render(
      <SelfDriveConfirmModal open={false} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(container.querySelector("[data-testid='dialog-root']")).toBeNull();
  });
});
