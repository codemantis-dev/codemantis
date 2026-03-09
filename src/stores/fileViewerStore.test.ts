import { describe, it, expect, beforeEach } from "vitest";
import { useFileViewerStore, getLanguageFromPath } from "./fileViewerStore";

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

describe("fileViewerStore (multi-tab)", () => {
  beforeEach(() => {
    useFileViewerStore.setState({
      openFiles: [],
      activeFilePath: null,
      editedContents: new Map(),
      dirtyFiles: new Set(),
    });
  });

  it("starts with no files open", () => {
    const state = useFileViewerStore.getState();
    expect(state.openFiles).toHaveLength(0);
    expect(state.activeFilePath).toBeNull();
  });

  it("opens a file and sets it as active", () => {
    const tab = makeTab("/src/main.rs", "fn main() {}");
    useFileViewerStore.getState().openFile(tab);
    const state = useFileViewerStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.activeFilePath).toBe("/src/main.rs");
    expect(state.openFiles[0].content).toBe("fn main() {}");
  });

  it("opening same file twice focuses instead of duplicating", () => {
    const tab1 = makeTab("/src/main.rs", "v1");
    const tab2 = makeTab("/src/lib.ts", "v2");
    useFileViewerStore.getState().openFile(tab1);
    useFileViewerStore.getState().openFile(tab2);
    expect(useFileViewerStore.getState().activeFilePath).toBe("/src/lib.ts");

    // Re-open first file — should not duplicate
    const tab1Updated = makeTab("/src/main.rs", "v1-updated");
    useFileViewerStore.getState().openFile(tab1Updated);
    const state = useFileViewerStore.getState();
    expect(state.openFiles).toHaveLength(2);
    expect(state.activeFilePath).toBe("/src/main.rs");
    expect(state.openFiles[0].content).toBe("v1-updated");
  });

  it("closes a file and cleans up state", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts", "a"));
    useFileViewerStore.getState().openFile(makeTab("/b.rs", "b"));
    useFileViewerStore.getState().closeFile("/b.rs");
    const state = useFileViewerStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.openFiles[0].filePath).toBe("/a.ts");
  });

  it("closing active tab switches to last remaining tab", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(makeTab("/b.rs"));
    useFileViewerStore.getState().openFile(makeTab("/c.py"));
    expect(useFileViewerStore.getState().activeFilePath).toBe("/c.py");

    useFileViewerStore.getState().closeFile("/c.py");
    expect(useFileViewerStore.getState().activeFilePath).toBe("/b.rs");
  });

  it("closing last tab sets activeFilePath to null", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts"));
    useFileViewerStore.getState().closeFile("/a.ts");
    expect(useFileViewerStore.getState().activeFilePath).toBeNull();
    expect(useFileViewerStore.getState().openFiles).toHaveLength(0);
  });

  it("dirty state is per-file", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts", "original-a"));
    useFileViewerStore.getState().openFile(makeTab("/b.rs", "original-b"));

    useFileViewerStore.getState().setEditedContent("/a.ts", "modified-a");
    const state = useFileViewerStore.getState();
    expect(state.dirtyFiles.has("/a.ts")).toBe(true);
    expect(state.dirtyFiles.has("/b.rs")).toBe(false);
  });

  it("markSaved clears dirty and updates tab content", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts", "original"));
    useFileViewerStore.getState().setEditedContent("/a.ts", "modified");
    expect(useFileViewerStore.getState().dirtyFiles.has("/a.ts")).toBe(true);

    useFileViewerStore.getState().markSaved("/a.ts");
    const state = useFileViewerStore.getState();
    expect(state.dirtyFiles.has("/a.ts")).toBe(false);
    expect(state.openFiles[0].content).toBe("modified");
  });

  it("setActiveFile switches active tab", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(makeTab("/b.rs"));
    expect(useFileViewerStore.getState().activeFilePath).toBe("/b.rs");

    useFileViewerStore.getState().setActiveFile("/a.ts");
    expect(useFileViewerStore.getState().activeFilePath).toBe("/a.ts");
  });

  it("setActiveFile ignores non-open paths", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts"));
    useFileViewerStore.getState().setActiveFile("/nonexistent.ts");
    expect(useFileViewerStore.getState().activeFilePath).toBe("/a.ts");
  });

  it("closeAllFiles resets everything", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(makeTab("/b.rs"));
    useFileViewerStore.getState().setEditedContent("/a.ts", "dirty");
    useFileViewerStore.getState().closeAllFiles();

    const state = useFileViewerStore.getState();
    expect(state.openFiles).toHaveLength(0);
    expect(state.activeFilePath).toBeNull();
    expect(state.editedContents.size).toBe(0);
    expect(state.dirtyFiles.size).toBe(0);
  });

  it("supports diff mode", () => {
    useFileViewerStore.getState().openFile({
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
    const tab = useFileViewerStore.getState().openFiles[0];
    expect(tab.isDiff).toBe(true);
    expect(tab.oldContent).toBe("const a = 1;");
    expect(tab.newContent).toBe("const a = 2;");
  });

  it("closeFile cleans up editedContents and dirtyFiles for that path", () => {
    useFileViewerStore.getState().openFile(makeTab("/a.ts", "original"));
    useFileViewerStore.getState().setEditedContent("/a.ts", "modified");
    expect(useFileViewerStore.getState().dirtyFiles.has("/a.ts")).toBe(true);
    expect(useFileViewerStore.getState().editedContents.has("/a.ts")).toBe(true);

    useFileViewerStore.getState().closeFile("/a.ts");
    expect(useFileViewerStore.getState().dirtyFiles.has("/a.ts")).toBe(false);
    expect(useFileViewerStore.getState().editedContents.has("/a.ts")).toBe(false);
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
    expect(getLanguageFromPath("Makefile")).toBe("plaintext");
    expect(getLanguageFromPath("Dockerfile")).toBe("plaintext");
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
