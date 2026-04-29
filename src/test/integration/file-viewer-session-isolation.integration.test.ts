/**
 * Integration test: FileViewer state stays isolated per session
 *
 * Regression coverage for a bug where opening a file in one session sub-tab
 * leaked into a sibling session sub-tab in the same project: switching to
 * the sibling caused its right panel to display the file from the other
 * session, since FileViewer state was keyed by projectPath.
 *
 * After the fix, FileViewer state is keyed by sessionId. These tests use
 * REAL stores (no mocks) to verify the wiring across sessionStore,
 * fileViewerStore, and uiStore.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useUiStore } from "../../stores/uiStore";
import type { Session } from "../../types/session";

const PROJECT = "/tmp/shared-project";
const SESSION_A = "session-a";
const SESSION_B = "session-b";

function makeSession(id: string, name: string, projectPath: string): Session {
  return {
    id,
    name,
    project_path: projectPath,
    status: "connected",
    created_at: new Date().toISOString(),
    model: null,
    icon_index: 0,
  };
}

function makeTab(filePath: string, content = "content") {
  const fileName = filePath.split("/").pop() ?? filePath;
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return {
    filePath,
    fileName,
    language: "plaintext",
    extension: ext,
    fileSize: content.length,
    content,
    isDiff: false,
  };
}

describe("FileViewer per-session isolation (same project)", () => {
  beforeEach(() => {
    resetAllStores();
    // Two sibling sessions inside the same project.
    useSessionStore.setState({
      sessions: new Map([
        [SESSION_A, makeSession(SESSION_A, "A", PROJECT)],
        [SESSION_B, makeSession(SESSION_B, "B", PROJECT)],
      ]),
      tabOrder: [SESSION_A, SESSION_B],
      activeProjectPath: PROJECT,
      activeSessionId: SESSION_A,
      projectActiveSession: new Map([[PROJECT, SESSION_A]]),
      projectOrder: [PROJECT],
    });
  });

  it("file opened in Session A does not appear in Session B", () => {
    useFileViewerStore.getState().openFile(SESSION_A, makeTab("/tmp/shared-project/a.ts"));

    const sessionAFiles = useFileViewerStore.getState().sessionOpenFiles.get(SESSION_A) ?? [];
    const sessionBFiles = useFileViewerStore.getState().sessionOpenFiles.get(SESSION_B) ?? [];

    expect(sessionAFiles).toHaveLength(1);
    expect(sessionAFiles[0].filePath).toBe("/tmp/shared-project/a.ts");
    expect(sessionBFiles).toHaveLength(0);
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION_B) ?? null).toBeNull();
  });

  it("switching to a sibling session restores its own right tab without leaking files", () => {
    // Session A: open file → right tab is "files"
    useFileViewerStore.getState().openFile(SESSION_A, makeTab("/tmp/shared-project/a.ts"));
    useUiStore.getState().setRightTab("files");
    expect(useUiStore.getState().rightTab).toBe("files");

    // Session A: user clicks Activity tab — saves "activity" for A
    useUiStore.getState().setRightTab("activity");

    // Switch active session A → B
    useSessionStore.getState().setActiveSessionInProject(PROJECT, SESSION_B);
    useUiStore.getState().restoreSessionRightTab(SESSION_A, SESSION_B);

    // B was never visited, so its restored tab falls back to current ("activity")
    expect(useUiStore.getState().rightTab).toBe("activity");
    // And critically: B's file viewer is empty — A's file does not leak.
    const filesForB = useFileViewerStore.getState().sessionOpenFiles.get(SESSION_B) ?? [];
    expect(filesForB).toHaveLength(0);

    // Switching back preserves Session A's open file and dirty state.
    useUiStore.getState().restoreSessionRightTab(SESSION_B, SESSION_A);
    useSessionStore.getState().setActiveSessionInProject(PROJECT, SESSION_A);
    const filesForA = useFileViewerStore.getState().sessionOpenFiles.get(SESSION_A) ?? [];
    expect(filesForA).toHaveLength(1);
    expect(filesForA[0].filePath).toBe("/tmp/shared-project/a.ts");
  });

  it("dirty edits in Session A do not affect Session B viewing the same path", () => {
    useFileViewerStore.getState().openFile(SESSION_A, makeTab("/tmp/shared-project/shared.ts", "v0"));
    useFileViewerStore.getState().openFile(SESSION_B, makeTab("/tmp/shared-project/shared.ts", "v0"));

    useFileViewerStore.getState().setEditedContent(SESSION_A, "/tmp/shared-project/shared.ts", "edited-in-A");

    expect(
      useFileViewerStore.getState().sessionDirtyFiles.get(SESSION_A)?.has("/tmp/shared-project/shared.ts"),
    ).toBe(true);
    expect(
      useFileViewerStore.getState().sessionDirtyFiles.get(SESSION_B)?.has("/tmp/shared-project/shared.ts") ?? false,
    ).toBe(false);
  });

  it("removing a session frees its file viewer state", () => {
    useFileViewerStore.getState().openFile(SESSION_A, makeTab("/tmp/shared-project/a.ts"));
    useFileViewerStore.getState().setEditedContent(SESSION_A, "/tmp/shared-project/a.ts", "dirty");

    useSessionStore.getState().removeSession(SESSION_A);

    const fv = useFileViewerStore.getState();
    expect(fv.sessionOpenFiles.has(SESSION_A)).toBe(false);
    expect(fv.sessionActiveFile.has(SESSION_A)).toBe(false);
    expect(fv.sessionEditedContents.has(SESSION_A)).toBe(false);
    expect(fv.sessionDirtyFiles.has(SESSION_A)).toBe(false);
  });
});
