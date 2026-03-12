import { describe, it, expect, beforeEach } from "vitest";
import { usePreviewStore } from "./previewStore";
import type { DevServerState, ConsoleLogEntry } from "../types/preview";

function resetStore(): void {
  usePreviewStore.setState({
    devServer: new Map(),
    previewOpen: new Map(),
    consoleLogs: new Map(),
    consoleDrawerOpen: false,
    viewportPreset: "desktop",
    unreadErrors: new Map(),
  });
}

const PROJECT_A = "/Users/test/project-a";
const PROJECT_B = "/Users/test/project-b";

const DEV_SERVER: DevServerState = {
  terminalId: "term-1",
  sessionId: "devserver-abc123",
  port: 3000,
  url: "http://localhost:3000",
  status: "running",
};

function makeConsoleLog(
  overrides: Partial<ConsoleLogEntry> = {},
): ConsoleLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random()}`,
    level: "log",
    timestamp: Date.now(),
    message: "test log",
    ...overrides,
  };
}

describe("previewStore", () => {
  beforeEach(resetStore);

  describe("setDevServer", () => {
    it("sets dev server state for a project", () => {
      usePreviewStore.getState().setDevServer(PROJECT_A, DEV_SERVER);
      const state = usePreviewStore.getState();
      expect(state.devServer.get(PROJECT_A)).toEqual(DEV_SERVER);
    });

    it("merges partial updates into existing state", () => {
      usePreviewStore.getState().setDevServer(PROJECT_A, DEV_SERVER);
      usePreviewStore.getState().setDevServer(PROJECT_A, { port: 3001 });
      const server = usePreviewStore.getState().devServer.get(PROJECT_A);
      expect(server?.port).toBe(3001);
      expect(server?.terminalId).toBe("term-1");
      expect(server?.url).toBe("http://localhost:3000");
    });

    it("keeps projects isolated from each other", () => {
      usePreviewStore.getState().setDevServer(PROJECT_A, DEV_SERVER);
      usePreviewStore
        .getState()
        .setDevServer(PROJECT_B, { ...DEV_SERVER, port: 5173 });
      expect(usePreviewStore.getState().devServer.get(PROJECT_A)?.port).toBe(
        3000,
      );
      expect(usePreviewStore.getState().devServer.get(PROJECT_B)?.port).toBe(
        5173,
      );
    });
  });

  describe("clearDevServer", () => {
    it("removes dev server state for a project", () => {
      usePreviewStore.getState().setDevServer(PROJECT_A, DEV_SERVER);
      usePreviewStore.getState().clearDevServer(PROJECT_A);
      expect(usePreviewStore.getState().devServer.has(PROJECT_A)).toBe(false);
    });

    it("does not affect other projects", () => {
      usePreviewStore.getState().setDevServer(PROJECT_A, DEV_SERVER);
      usePreviewStore
        .getState()
        .setDevServer(PROJECT_B, { ...DEV_SERVER, port: 5173 });
      usePreviewStore.getState().clearDevServer(PROJECT_A);
      expect(usePreviewStore.getState().devServer.has(PROJECT_A)).toBe(false);
      expect(usePreviewStore.getState().devServer.has(PROJECT_B)).toBe(true);
    });

    it("is a no-op for unknown project", () => {
      usePreviewStore.getState().clearDevServer("/nonexistent");
      expect(usePreviewStore.getState().devServer.size).toBe(0);
    });
  });

  describe("setPreviewOpen", () => {
    it("marks preview as open", () => {
      usePreviewStore.getState().setPreviewOpen(PROJECT_A, true);
      expect(usePreviewStore.getState().previewOpen.get(PROJECT_A)).toBe(true);
    });

    it("marks preview as closed", () => {
      usePreviewStore.getState().setPreviewOpen(PROJECT_A, true);
      usePreviewStore.getState().setPreviewOpen(PROJECT_A, false);
      expect(usePreviewStore.getState().previewOpen.get(PROJECT_A)).toBe(false);
    });

    it("tracks per-project independently", () => {
      usePreviewStore.getState().setPreviewOpen(PROJECT_A, true);
      usePreviewStore.getState().setPreviewOpen(PROJECT_B, false);
      expect(usePreviewStore.getState().previewOpen.get(PROJECT_A)).toBe(true);
      expect(usePreviewStore.getState().previewOpen.get(PROJECT_B)).toBe(false);
    });
  });

  describe("addConsoleLog", () => {
    it("adds a log entry to the project", () => {
      const entry = makeConsoleLog({ message: "Hello" });
      usePreviewStore.getState().addConsoleLog(PROJECT_A, entry);
      const logs = usePreviewStore.getState().consoleLogs.get(PROJECT_A);
      expect(logs).toHaveLength(1);
      expect(logs![0].message).toBe("Hello");
    });

    it("appends to existing logs", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog({ message: "first" }));
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog({ message: "second" }));
      const logs = usePreviewStore.getState().consoleLogs.get(PROJECT_A);
      expect(logs).toHaveLength(2);
      expect(logs![0].message).toBe("first");
      expect(logs![1].message).toBe("second");
    });

    it("increments unreadErrors for error-level logs", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_A,
          makeConsoleLog({ level: "error", message: "Oops" }),
        );
      expect(usePreviewStore.getState().unreadErrors.get(PROJECT_A)).toBe(1);
    });

    it("does not increment unreadErrors for non-error logs", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_A,
          makeConsoleLog({ level: "log", message: "info" }),
        );
      expect(
        usePreviewStore.getState().unreadErrors.get(PROJECT_A) ?? 0,
      ).toBe(0);
    });

    it("accumulates unread error count", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog({ level: "error" }));
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog({ level: "error" }));
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog({ level: "error" }));
      expect(usePreviewStore.getState().unreadErrors.get(PROJECT_A)).toBe(3);
    });

    it("caps logs at 500 entries", () => {
      for (let i = 0; i < 510; i++) {
        usePreviewStore
          .getState()
          .addConsoleLog(
            PROJECT_A,
            makeConsoleLog({ id: `log-${i}`, message: `msg ${i}` }),
          );
      }
      const logs = usePreviewStore.getState().consoleLogs.get(PROJECT_A)!;
      expect(logs).toHaveLength(500);
      // Oldest entries should be dropped — first entry should be msg 10
      expect(logs[0].message).toBe("msg 10");
      expect(logs[499].message).toBe("msg 509");
    });

    it("keeps projects isolated", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog({ message: "A" }));
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_B, makeConsoleLog({ message: "B" }));
      expect(
        usePreviewStore.getState().consoleLogs.get(PROJECT_A),
      ).toHaveLength(1);
      expect(
        usePreviewStore.getState().consoleLogs.get(PROJECT_B),
      ).toHaveLength(1);
    });
  });

  describe("clearConsoleLogs", () => {
    it("clears all logs for a project", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog());
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog());
      usePreviewStore.getState().clearConsoleLogs(PROJECT_A);
      expect(
        usePreviewStore.getState().consoleLogs.get(PROJECT_A),
      ).toHaveLength(0);
    });

    it("resets unread error count", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_A,
          makeConsoleLog({ level: "error" }),
        );
      usePreviewStore.getState().clearConsoleLogs(PROJECT_A);
      expect(usePreviewStore.getState().unreadErrors.get(PROJECT_A)).toBe(0);
    });

    it("does not affect other projects", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_A, makeConsoleLog());
      usePreviewStore
        .getState()
        .addConsoleLog(PROJECT_B, makeConsoleLog());
      usePreviewStore.getState().clearConsoleLogs(PROJECT_A);
      expect(
        usePreviewStore.getState().consoleLogs.get(PROJECT_A),
      ).toHaveLength(0);
      expect(
        usePreviewStore.getState().consoleLogs.get(PROJECT_B),
      ).toHaveLength(1);
    });
  });

  describe("setViewportPreset", () => {
    it("defaults to desktop", () => {
      expect(usePreviewStore.getState().viewportPreset).toBe("desktop");
    });

    it("switches to mobile", () => {
      usePreviewStore.getState().setViewportPreset("mobile");
      expect(usePreviewStore.getState().viewportPreset).toBe("mobile");
    });

    it("switches to tablet", () => {
      usePreviewStore.getState().setViewportPreset("tablet");
      expect(usePreviewStore.getState().viewportPreset).toBe("tablet");
    });
  });

  describe("toggleConsoleDrawer", () => {
    it("defaults to closed", () => {
      expect(usePreviewStore.getState().consoleDrawerOpen).toBe(false);
    });

    it("toggles open", () => {
      usePreviewStore.getState().toggleConsoleDrawer();
      expect(usePreviewStore.getState().consoleDrawerOpen).toBe(true);
    });

    it("toggles closed again", () => {
      usePreviewStore.getState().toggleConsoleDrawer();
      usePreviewStore.getState().toggleConsoleDrawer();
      expect(usePreviewStore.getState().consoleDrawerOpen).toBe(false);
    });
  });

  describe("resetUnreadErrors", () => {
    it("resets error count to zero", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_A,
          makeConsoleLog({ level: "error" }),
        );
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_A,
          makeConsoleLog({ level: "error" }),
        );
      usePreviewStore.getState().resetUnreadErrors(PROJECT_A);
      expect(usePreviewStore.getState().unreadErrors.get(PROJECT_A)).toBe(0);
    });

    it("does not affect other projects", () => {
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_A,
          makeConsoleLog({ level: "error" }),
        );
      usePreviewStore
        .getState()
        .addConsoleLog(
          PROJECT_B,
          makeConsoleLog({ level: "error" }),
        );
      usePreviewStore.getState().resetUnreadErrors(PROJECT_A);
      expect(usePreviewStore.getState().unreadErrors.get(PROJECT_A)).toBe(0);
      expect(usePreviewStore.getState().unreadErrors.get(PROJECT_B)).toBe(1);
    });
  });
});
