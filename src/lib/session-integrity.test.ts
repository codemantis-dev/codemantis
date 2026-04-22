import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useSessionStore } from "../stores/sessionStore";
import { assertActivitySessionScope } from "./session-integrity";

function setSessions(entries: Array<[string, { project_path: string }]>, activeProjectPath: string, activeSessionId: string | null = null) {
  useSessionStore.setState({
    sessions: new Map(entries.map(([id, s]) => [id, { id, name: "s", project_path: s.project_path, status: "connected" as const, created_at: "", model: null, icon_index: 0 }])),
    activeProjectPath,
    activeSessionId,
    tabOrder: entries.map(([id]) => id),
  });
}

describe("assertActivitySessionScope", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let traceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    traceSpy = vi.spyOn(console, "trace").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    traceSpy.mockRestore();
    useSessionStore.setState({ sessions: new Map(), activeProjectPath: null, activeSessionId: null, tabOrder: [] });
  });

  it("warns when sessionId is not in the session map", () => {
    setSessions([["known", { project_path: "/project/a" }]], "/project/a", "known");
    assertActivitySessionScope("ghost", { toolName: "Bash", toolInput: { command: "ls" } }, "test");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown session id"),
      expect.objectContaining({ sessionId: "ghost", toolName: "Bash" }),
    );
    expect(traceSpy).toHaveBeenCalled();
  });

  it("warns when file_path is absolute and outside session.project_path", () => {
    setSessions([["s1", { project_path: "/project/a" }]], "/project/a", "s1");
    assertActivitySessionScope(
      "s1",
      { toolName: "Read", toolInput: { file_path: "/project/b/foo.ts" } },
      "test",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("outside session.project_path"),
      expect.objectContaining({ sessionId: "s1", sessionProjectPath: "/project/a", filePath: "/project/b/foo.ts" }),
    );
  });

  it("does not warn when file_path is within session.project_path", () => {
    setSessions([["s1", { project_path: "/project/a" }]], "/project/a", "s1");
    assertActivitySessionScope(
      "s1",
      { toolName: "Read", toolInput: { file_path: "/project/a/foo.ts" } },
      "test",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn for relative file_paths", () => {
    setSessions([["s1", { project_path: "/project/a" }]], "/project/a", "s1");
    assertActivitySessionScope(
      "s1",
      { toolName: "Read", toolInput: { file_path: "src/foo.ts" } },
      "test",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when bash command references an absolute path outside session.project_path", () => {
    setSessions([["s1", { project_path: "/Users/me/project-a" }]], "/Users/me/project-a", "s1");
    assertActivitySessionScope(
      "s1",
      { toolName: "Bash", toolInput: { command: "find /Users/me/project-b -name '*.py'" } },
      "test",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("outside session.project_path"),
      expect.objectContaining({ sessionId: "s1" }),
    );
  });

  it("does not warn when bash command stays within the project", () => {
    setSessions([["s1", { project_path: "/Users/me/project-a" }]], "/Users/me/project-a", "s1");
    assertActivitySessionScope(
      "s1",
      { toolName: "Bash", toolInput: { command: "find /Users/me/project-a/src -name '*.ts'" } },
      "test",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn on commands with no absolute paths", () => {
    setSessions([["s1", { project_path: "/Users/me/project-a" }]], "/Users/me/project-a", "s1");
    assertActivitySessionScope(
      "s1",
      { toolName: "Bash", toolInput: { command: "pnpm test" } },
      "test",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
