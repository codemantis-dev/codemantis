import { describe, it, expect, beforeEach } from "vitest";
import { useFileViewerStore, getLanguageFromPath } from "./fileViewerStore";

const SESSION = "session-1";

function makeTab(filePath: string, content: string = "content") {
  const fileName = filePath.split("/").pop() ?? filePath;
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return {
    filePath,
    fileName,
    language: ext === "rs" ? "rust" : ext === "ts" || ext === "tsx" ? "typescript" : "plaintext",
    extension: ext,
    fileSize: content.length,
    content,
    isDiff: false,
  };
}

describe("fileViewerStore (per-session multi-tab)", () => {
  beforeEach(() => {
    useFileViewerStore.setState({
      sessionOpenFiles: new Map(),
      sessionActiveFile: new Map(),
      sessionEditedContents: new Map(),
      sessionDirtyFiles: new Map(),
    });
  });

  it("starts with no files open", () => {
    const state = useFileViewerStore.getState();
    expect(state.sessionOpenFiles.get(SESSION) ?? []).toHaveLength(0);
    expect(state.sessionActiveFile.get(SESSION) ?? null).toBeNull();
  });

  it("opens a file and sets it as active", () => {
    const tab = makeTab("/src/main.rs", "fn main() {}");
    useFileViewerStore.getState().openFile(SESSION, tab);
    const state = useFileViewerStore.getState();
    expect(state.sessionOpenFiles.get(SESSION)).toHaveLength(1);
    expect(state.sessionActiveFile.get(SESSION)).toBe("/src/main.rs");
    expect(state.sessionOpenFiles.get(SESSION)![0].content).toBe("fn main() {}");
  });

  it("opening same file twice focuses instead of duplicating", () => {
    const tab1 = makeTab("/src/main.rs", "v1");
    const tab2 = makeTab("/src/lib.ts", "v2");
    useFileViewerStore.getState().openFile(SESSION, tab1);
    useFileViewerStore.getState().openFile(SESSION, tab2);
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBe("/src/lib.ts");

    // Re-open first file — should not duplicate
    const tab1Updated = makeTab("/src/main.rs", "v1-updated");
    useFileViewerStore.getState().openFile(SESSION, tab1Updated);
    const state = useFileViewerStore.getState();
    expect(state.sessionOpenFiles.get(SESSION)).toHaveLength(2);
    expect(state.sessionActiveFile.get(SESSION)).toBe("/src/main.rs");
    expect(state.sessionOpenFiles.get(SESSION)![0].content).toBe("v1-updated");
  });

  it("closes a file and cleans up state", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts", "a"));
    useFileViewerStore.getState().openFile(SESSION, makeTab("/b.rs", "b"));
    useFileViewerStore.getState().closeFile(SESSION, "/b.rs");
    const state = useFileViewerStore.getState();
    expect(state.sessionOpenFiles.get(SESSION)).toHaveLength(1);
    expect(state.sessionOpenFiles.get(SESSION)![0].filePath).toBe("/a.ts");
  });

  it("closing active tab switches to last remaining tab", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(SESSION, makeTab("/b.rs"));
    useFileViewerStore.getState().openFile(SESSION, makeTab("/c.py"));
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBe("/c.py");

    useFileViewerStore.getState().closeFile(SESSION, "/c.py");
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBe("/b.rs");
  });

  it("closing last tab sets activeFilePath to null", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts"));
    useFileViewerStore.getState().closeFile(SESSION, "/a.ts");
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBeNull();
    expect(useFileViewerStore.getState().sessionOpenFiles.get(SESSION)).toHaveLength(0);
  });

  it("dirty state is per-file", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts", "original-a"));
    useFileViewerStore.getState().openFile(SESSION, makeTab("/b.rs", "original-b"));

    useFileViewerStore.getState().setEditedContent(SESSION, "/a.ts", "modified-a");
    const dirtyFiles = useFileViewerStore.getState().sessionDirtyFiles.get(SESSION)!;
    expect(dirtyFiles.has("/a.ts")).toBe(true);
    expect(dirtyFiles.has("/b.rs")).toBe(false);
  });

  it("markSaved clears dirty and updates tab content", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts", "original"));
    useFileViewerStore.getState().setEditedContent(SESSION, "/a.ts", "modified");
    expect(useFileViewerStore.getState().sessionDirtyFiles.get(SESSION)!.has("/a.ts")).toBe(true);

    useFileViewerStore.getState().markSaved(SESSION, "/a.ts");
    const state = useFileViewerStore.getState();
    expect(state.sessionDirtyFiles.get(SESSION)!.has("/a.ts")).toBe(false);
    expect(state.sessionOpenFiles.get(SESSION)![0].content).toBe("modified");
  });

  it("setActiveFile switches active tab", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(SESSION, makeTab("/b.rs"));
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBe("/b.rs");

    useFileViewerStore.getState().setActiveFile(SESSION, "/a.ts");
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBe("/a.ts");
  });

  it("setActiveFile ignores non-open paths", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts"));
    useFileViewerStore.getState().setActiveFile(SESSION, "/nonexistent.ts");
    expect(useFileViewerStore.getState().sessionActiveFile.get(SESSION)).toBe("/a.ts");
  });

  it("closeAllFiles resets everything for session", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(SESSION, makeTab("/b.rs"));
    useFileViewerStore.getState().setEditedContent(SESSION, "/a.ts", "dirty");
    useFileViewerStore.getState().closeAllFiles(SESSION);

    const state = useFileViewerStore.getState();
    expect(state.sessionOpenFiles.get(SESSION)).toHaveLength(0);
    expect(state.sessionActiveFile.get(SESSION)).toBeNull();
    expect(state.sessionEditedContents.get(SESSION)!.size).toBe(0);
    expect(state.sessionDirtyFiles.get(SESSION)!.size).toBe(0);
  });

  it("toggleFileDiff switches from diff to normal view", () => {
    useFileViewerStore.getState().openFile(SESSION, {
      filePath: "/src/lib.ts",
      fileName: "lib.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 24,
      content: null,
      isDiff: true,
      oldContent: "const a = 1;",
      newContent: "const a = 2;",
    });

    // Toggle: diff → normal
    useFileViewerStore.getState().toggleFileDiff(SESSION, "/src/lib.ts");
    const tab = useFileViewerStore.getState().sessionOpenFiles.get(SESSION)![0];
    expect(tab.isDiff).toBe(false);
    expect(tab.content).toBe("const a = 2;"); // newContent becomes content
    // Old/new content preserved for toggling back
    expect(tab.oldContent).toBe("const a = 1;");
    expect(tab.newContent).toBe("const a = 2;");
  });

  it("toggleFileDiff switches from normal back to diff view", () => {
    useFileViewerStore.getState().openFile(SESSION, {
      filePath: "/src/lib.ts",
      fileName: "lib.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 24,
      content: "const a = 2;",
      isDiff: false,
      oldContent: "const a = 1;",
      newContent: "const a = 2;",
    });

    // Toggle: normal → diff (has oldContent + newContent)
    useFileViewerStore.getState().toggleFileDiff(SESSION, "/src/lib.ts");
    const tab = useFileViewerStore.getState().sessionOpenFiles.get(SESSION)![0];
    expect(tab.isDiff).toBe(true);
  });

  it("toggleFileDiff does nothing for files without diff data", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/src/plain.ts", "content"));

    useFileViewerStore.getState().toggleFileDiff(SESSION, "/src/plain.ts");
    const tab = useFileViewerStore.getState().sessionOpenFiles.get(SESSION)![0];
    expect(tab.isDiff).toBe(false); // unchanged
  });

  it("supports diff mode", () => {
    useFileViewerStore.getState().openFile(SESSION, {
      filePath: "/src/lib.ts",
      fileName: "lib.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 24,
      content: null,
      isDiff: true,
      oldContent: "const a = 1;",
      newContent: "const a = 2;",
    });
    const tab = useFileViewerStore.getState().sessionOpenFiles.get(SESSION)![0];
    expect(tab.isDiff).toBe(true);
    expect(tab.oldContent).toBe("const a = 1;");
    expect(tab.newContent).toBe("const a = 2;");
  });

  it("closeFile cleans up editedContents and dirtyFiles for that path", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts", "original"));
    useFileViewerStore.getState().setEditedContent(SESSION, "/a.ts", "modified");
    expect(useFileViewerStore.getState().sessionDirtyFiles.get(SESSION)!.has("/a.ts")).toBe(true);
    expect(useFileViewerStore.getState().sessionEditedContents.get(SESSION)!.has("/a.ts")).toBe(true);

    useFileViewerStore.getState().closeFile(SESSION, "/a.ts");
    expect(useFileViewerStore.getState().sessionDirtyFiles.get(SESSION)!.has("/a.ts")).toBe(false);
    expect(useFileViewerStore.getState().sessionEditedContents.get(SESSION)!.has("/a.ts")).toBe(false);
  });

  it("clearSession removes all data for a session", () => {
    useFileViewerStore.getState().openFile(SESSION, makeTab("/a.ts"));
    useFileViewerStore.getState().setEditedContent(SESSION, "/a.ts", "dirty");
    useFileViewerStore.getState().clearSession(SESSION);

    const state = useFileViewerStore.getState();
    expect(state.sessionOpenFiles.has(SESSION)).toBe(false);
    expect(state.sessionActiveFile.has(SESSION)).toBe(false);
    expect(state.sessionEditedContents.has(SESSION)).toBe(false);
    expect(state.sessionDirtyFiles.has(SESSION)).toBe(false);
  });

  it("isolates files between different sessions (regression: same-project leak)", () => {
    const sessionA = "session-A";
    const sessionB = "session-B";
    // Both sessions belong to the same project, but the store is keyed by
    // sessionId — opening a file in A must not surface in B.
    useFileViewerStore.getState().openFile(sessionA, makeTab("/a.ts", "a-content"));
    useFileViewerStore.getState().openFile(sessionB, makeTab("/b.rs", "b-content"));

    expect(useFileViewerStore.getState().sessionOpenFiles.get(sessionA)).toHaveLength(1);
    expect(useFileViewerStore.getState().sessionOpenFiles.get(sessionB)).toHaveLength(1);
    expect(useFileViewerStore.getState().sessionActiveFile.get(sessionA)).toBe("/a.ts");
    expect(useFileViewerStore.getState().sessionActiveFile.get(sessionB)).toBe("/b.rs");
  });

  it("opening the same file path in two sessions tracks dirty state independently", () => {
    const sessionA = "session-A";
    const sessionB = "session-B";
    useFileViewerStore.getState().openFile(sessionA, makeTab("/shared.ts", "original"));
    useFileViewerStore.getState().openFile(sessionB, makeTab("/shared.ts", "original"));

    useFileViewerStore.getState().setEditedContent(sessionA, "/shared.ts", "edited-in-A");

    expect(useFileViewerStore.getState().sessionDirtyFiles.get(sessionA)!.has("/shared.ts")).toBe(true);
    expect(useFileViewerStore.getState().sessionDirtyFiles.get(sessionB)?.has("/shared.ts") ?? false).toBe(false);
    expect(useFileViewerStore.getState().sessionEditedContents.get(sessionA)!.get("/shared.ts")).toBe("edited-in-A");
    expect(useFileViewerStore.getState().sessionEditedContents.get(sessionB)?.get("/shared.ts")).toBeUndefined();
  });
});

describe("getLanguageFromPath", () => {
  it("detects TypeScript", () => {
    expect(getLanguageFromPath("src/app.ts")).toBe("typescript");
    expect(getLanguageFromPath("src/App.tsx")).toBe("typescript");
  });

  it("detects JavaScript", () => {
    expect(getLanguageFromPath("index.js")).toBe("javascript");
    expect(getLanguageFromPath("App.jsx")).toBe("javascript");
  });

  it("detects Rust", () => {
    expect(getLanguageFromPath("main.rs")).toBe("rust");
  });

  it("detects Python", () => {
    expect(getLanguageFromPath("app.py")).toBe("python");
  });

  it("detects JSON", () => {
    expect(getLanguageFromPath("package.json")).toBe("json");
  });

  it("detects CSS", () => {
    expect(getLanguageFromPath("style.css")).toBe("css");
  });

  it("detects HTML", () => {
    expect(getLanguageFromPath("index.html")).toBe("html");
  });

  it("detects YAML", () => {
    expect(getLanguageFromPath("config.yaml")).toBe("yaml");
    expect(getLanguageFromPath("config.yml")).toBe("yaml");
  });

  it("detects TOML", () => {
    expect(getLanguageFromPath("Cargo.toml")).toBe("toml");
  });

  it("detects SQL", () => {
    expect(getLanguageFromPath("schema.sql")).toBe("sql");
  });

  it("detects shell scripts", () => {
    expect(getLanguageFromPath("deploy.sh")).toBe("shell");
    expect(getLanguageFromPath("run.bash")).toBe("shell");
    expect(getLanguageFromPath("init.zsh")).toBe("shell");
  });

  it("detects Go", () => {
    expect(getLanguageFromPath("main.go")).toBe("go");
  });

  it("detects Java", () => {
    expect(getLanguageFromPath("App.java")).toBe("java");
  });

  it("detects Ruby", () => {
    expect(getLanguageFromPath("server.rb")).toBe("ruby");
  });

  it("detects Swift", () => {
    expect(getLanguageFromPath("ViewController.swift")).toBe("swift");
  });

  it("detects C/C++", () => {
    expect(getLanguageFromPath("main.c")).toBe("c");
    expect(getLanguageFromPath("main.cpp")).toBe("cpp");
    expect(getLanguageFromPath("header.h")).toBe("c");
    expect(getLanguageFromPath("header.hpp")).toBe("cpp");
  });

  it("detects C#", () => {
    expect(getLanguageFromPath("Program.cs")).toBe("csharp");
  });

  it("detects Kotlin", () => {
    expect(getLanguageFromPath("Main.kt")).toBe("kotlin");
  });

  it("detects XML/SVG", () => {
    expect(getLanguageFromPath("data.xml")).toBe("xml");
    expect(getLanguageFromPath("icon.svg")).toBe("xml");
  });

  it("detects Markdown", () => {
    expect(getLanguageFromPath("README.md")).toBe("markdown");
  });

  it("returns plaintext for unknown extensions", () => {
    expect(getLanguageFromPath("file.xyz")).toBe("plaintext");
    expect(getLanguageFromPath("data.bin")).toBe("plaintext");
  });

  it("handles files without extension", () => {
    expect(getLanguageFromPath("Makefile")).toBe("makefile");
    expect(getLanguageFromPath("Dockerfile")).toBe("dockerfile");
  });

  it("handles paths with multiple dots", () => {
    expect(getLanguageFromPath("config.dev.json")).toBe("json");
    expect(getLanguageFromPath("app.module.ts")).toBe("typescript");
  });

  it("is case insensitive for extension", () => {
    expect(getLanguageFromPath("README.MD")).toBe("markdown");
    expect(getLanguageFromPath("style.CSS")).toBe("css");
  });
});
