/**
 * Integration test: Tool Approval Round-Trip (frontend half)
 *
 * Proves the user-decision link of the approval flow at the React boundary:
 *
 *     Tauri event `tool-approval-request`
 *         ▼
 *     useToolApprovalListener  ──► enqueueApproval (activityStore)
 *                                              ▼
 *                                    ToolApproval modal renders
 *                                              ▼
 *                                    user clicks Deny / Approve / Always-allow
 *                                              ▼
 *                                    resolveToolApproval Tauri invoke
 *
 * The Rust half — `resolveToolApproval` invoke → `state.resolve(id, …)` →
 * oneshot → `HookResponse::deny|allow` on the wire — is covered by the
 * `round_trip_*` tests in `src-tauri/src/claude/approval_server.rs`.
 * Together they prove every link from "CLI fires hook" through "CLI
 * receives the user's decision" without exercising axum's HTTP machinery
 * (which is well-tested upstream).
 *
 * Mocking surface: only the Tauri IPC boundary (invoke, listen). React
 * components, Zustand stores, and event-routing are real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ToolApprovalRequestEvent } from "../../types/claude-events";
import { resetAllStores } from "../helpers/store-reset";

// We control the listener callbacks so we can fire synthetic
// `tool-approval-request` events on demand. `invoke` is spied on for
// `resolve_tool_approval` calls — that is the wire between this side and
// the approval server's pending oneshot.
const invokeMock = vi.fn();
const listenCallbacks = {
  toolApproval: null as ((e: ToolApprovalRequestEvent) => void) | null,
  modeChanged: null as ((e: { sessionId: string; mode: string }) => void) | null,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../lib/tauri-commands", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri-commands")>(
    "../../lib/tauri-commands",
  );
  return {
    ...actual,
    listenToolApprovalRequests: (cb: (e: ToolApprovalRequestEvent) => void) => {
      listenCallbacks.toolApproval = cb;
      return Promise.resolve(() => {
        listenCallbacks.toolApproval = null;
      });
    },
    listenSessionModeChanged: (cb: (e: { sessionId: string; mode: string }) => void) => {
      listenCallbacks.modeChanged = cb;
      return Promise.resolve(() => {
        listenCallbacks.modeChanged = null;
      });
    },
    resolveToolApproval: (requestId: string, approved: boolean, reason?: string) =>
      invokeMock("resolve_tool_approval", { requestId, approved, reason }),
  };
});

// Toast store mock — modal calls handleError/showToast on resolution
// failure paths and we want to assert behaviour without DOM toasts.
vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

import ToolApproval from "../../components/modals/ToolApproval";
import { useToolApprovalListener } from "../../hooks/useToolApprovalListener";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session } from "../../types/session";

const SESSION_ID = "session-rt-1";

function ListenerHost() {
  useToolApprovalListener();
  return null;
}

function ApprovalHarness() {
  return (
    <>
      <ListenerHost />
      <ToolApproval />
    </>
  );
}

function fireToolApprovalEvent(event: Partial<ToolApprovalRequestEvent> & {
  requestId: string;
  toolName: string;
}): void {
  const cb = listenCallbacks.toolApproval;
  if (!cb) {
    throw new Error(
      "useToolApprovalListener has not registered yet — wait for it to mount before firing events",
    );
  }
  cb({
    requestId: event.requestId,
    toolName: event.toolName,
    toolInput: event.toolInput ?? {},
    forgeSessionId: event.forgeSessionId ?? SESSION_ID,
  });
}

async function waitForListenerReady(): Promise<void> {
  await waitFor(() => {
    expect(listenCallbacks.toolApproval).not.toBeNull();
  });
}

describe("Tool Approval Round-Trip (Integration)", () => {
  beforeEach(() => {
    resetAllStores();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    listenCallbacks.toolApproval = null;
    listenCallbacks.modeChanged = null;
    // Seed an active session so the modal can resolve project metadata.
    useSessionStore.setState({
      sessions: new Map([
        [
          SESSION_ID,
          {
            id: SESSION_ID,
            name: "Test",
            project_path: "/tmp/proj",
            status: "connected",
            created_at: "",
            model: "default",
            icon_index: 0,
          },
        ],
      ]),
      activeSessionId: SESSION_ID,
      tabOrder: [SESSION_ID],
    });
  });

  it("Deny click invokes resolve_tool_approval(false) with the original requestId", async () => {
    render(<ApprovalHarness />);
    await waitForListenerReady();

    act(() => {
      fireToolApprovalEvent({
        requestId: "req-bash-1",
        toolName: "Bash",
        toolInput: { command: "rm -rf /tmp/some-file" },
      });
    });

    // Modal opens, queue contains one item, current item is the Bash request.
    await waitFor(() => {
      expect(useUiStore.getState().showApprovalModal).toBe(true);
      expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    });
    expect(screen.getAllByText("Bash").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Deny$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-bash-1",
        approved: false,
        reason: "Denied by user",
      });
    });

    // Modal cleans up after the dequeue cascade.
    await waitFor(() => {
      expect(useActivityStore.getState().approvalQueue).toHaveLength(0);
    });
  });

  it("Approve click invokes resolve_tool_approval(true) with no reason", async () => {
    render(<ApprovalHarness />);
    await waitForListenerReady();

    act(() => {
      fireToolApprovalEvent({
        requestId: "req-write-1",
        toolName: "Write",
        toolInput: { file_path: "src/foo.ts", content: "x" },
      });
    });

    await waitFor(() => {
      expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-write-1",
        approved: true,
        reason: undefined,
      });
    });
  });

  it("Always-allow auto-approves subsequent same-tool requests in the same session without re-opening the modal", async () => {
    render(<ApprovalHarness />);
    await waitForListenerReady();

    // First Bash request — user clicks "Always allow".
    act(() => {
      fireToolApprovalEvent({
        requestId: "req-bash-first",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });
    });
    await waitFor(() =>
      expect(useActivityStore.getState().approvalQueue).toHaveLength(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Always allow Bash in this session/i }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-bash-first",
        approved: true,
        reason: undefined,
      });
    });
    expect(
      useActivityStore.getState().isToolAlwaysAllowed(SESSION_ID, "Bash"),
    ).toBe(true);

    invokeMock.mockClear();

    // Second Bash request — listener must short-circuit to allow without
    // ever enqueueing or opening the modal.
    act(() => {
      fireToolApprovalEvent({
        requestId: "req-bash-second",
        toolName: "Bash",
        toolInput: { command: "pwd" },
      });
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-bash-second",
        approved: true,
        reason: undefined,
      });
    });
    expect(useActivityStore.getState().approvalQueue).toHaveLength(0);
  });

  it("Approve-all dispatches resolve_tool_approval(true) for each queued request", async () => {
    render(<ApprovalHarness />);
    await waitForListenerReady();

    act(() => {
      fireToolApprovalEvent({
        requestId: "req-batch-1",
        toolName: "Edit",
        toolInput: { file_path: "a.ts" },
      });
      fireToolApprovalEvent({
        requestId: "req-batch-2",
        toolName: "Edit",
        toolInput: { file_path: "b.ts" },
      });
      fireToolApprovalEvent({
        requestId: "req-batch-3",
        toolName: "Write",
        toolInput: { file_path: "c.ts" },
      });
    });
    await waitFor(() =>
      expect(useActivityStore.getState().approvalQueue).toHaveLength(3),
    );

    fireEvent.click(screen.getByRole("button", { name: /Approve all \(3\)/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-batch-1",
        approved: true,
        reason: undefined,
      });
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-batch-2",
        approved: true,
        reason: undefined,
      });
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-batch-3",
        approved: true,
        reason: undefined,
      });
    });
  });

  it("Codex session: subtitle says 'Codex wants to use a tool' and resolve passes a defined requestId", async () => {
    // Regression for the v1.3.0–v1.4.x cascade: missing
    // `rename_all = "camelCase"` on `codex::approvals::ApprovalRequest`
    // caused the listener to destructure undefined for every field
    // (badge "EX", empty body, "invalid args 'requestId'" on Approve).
    // The Rust regression test asserts the wire shape; this asserts the
    // post-shape end-to-end behaviour: the modal must read the Codex
    // session correctly and resolve with a real requestId.
    const codexSession: Session = {
      id: "session-codex-1",
      agent_id: "codex",
      name: "Codex Session",
      project_path: "/tmp/codex-proj",
      status: "connected",
      created_at: "",
      model: "gpt-5.5",
      icon_index: 0,
    };
    useSessionStore.setState((s) => {
      const next = new Map(s.sessions);
      next.set(codexSession.id, codexSession);
      return { sessions: next };
    });

    render(<ApprovalHarness />);
    await waitForListenerReady();

    act(() => {
      fireToolApprovalEvent({
        requestId: "req-codex-perm-1",
        toolName: "PermissionRequest",
        toolInput: { permissions: { network: true } },
        forgeSessionId: "session-codex-1",
      });
    });

    await waitFor(() => {
      expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    });

    // Agent-aware subtitle.
    expect(
      screen.getByText(/Codex wants to use a tool/i),
    ).toBeInTheDocument();
    // The new ApprovalSummary renders permissions as readable bullets,
    // not raw JSON.
    expect(
      screen.getByText(/Codex requests these permissions/i),
    ).toBeInTheDocument();
    expect(screen.getByText("network:")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
        requestId: "req-codex-perm-1",
        approved: true,
        reason: undefined,
      });
    });
    // The original symptom was an undefined requestId hitting Tauri —
    // explicitly guard against it returning.
    const call = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "resolve_tool_approval",
    );
    expect(call).toBeDefined();
    expect((call![1] as { requestId: unknown }).requestId).toBe(
      "req-codex-perm-1",
    );
  });

  it("Modal stays attached if the resolve call fails — the queue still drains, error surfaces via handleError", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "resolve_tool_approval") {
        return Promise.reject(new Error("approval server unreachable"));
      }
      return Promise.resolve(undefined);
    });

    render(<ApprovalHarness />);
    await waitForListenerReady();

    act(() => {
      fireToolApprovalEvent({
        requestId: "req-error-1",
        toolName: "Bash",
        toolInput: { command: "echo 'hi'" },
      });
    });
    await waitFor(() =>
      expect(useActivityStore.getState().approvalQueue).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Deny$/ }));

    // Even though the invoke rejected, the modal must still dequeue —
    // otherwise the user gets stuck on a stale request that the CLI has
    // already abandoned. The handleError path swallows the error (toast).
    await waitFor(() => {
      expect(useActivityStore.getState().approvalQueue).toHaveLength(0);
    });
    expect(invokeMock).toHaveBeenCalledWith("resolve_tool_approval", {
      requestId: "req-error-1",
      approved: false,
      reason: "Denied by user",
    });
  });
});
