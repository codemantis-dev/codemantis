import { describe, it, expect, beforeEach } from "vitest";
import { useFileViewerStore, getLanguageFromPath } from "./fileViewerStore";

const PROJECT = "/tmp/project";

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

describe("fileViewerStore (per-project multi-tab)", () => {
  beforeEach(() => {
    useFileViewerStore.setState({
      projectOpenFiles: new Map(),
      projectActiveFile: new Map(),
      projectEditedContents: new Map(),
      projectDirtyFiles: new Map(),
    });
  });

  it("starts with no files open", () => {
    const state = useFileViewerStore.getState();
    expect(state.projectOpenFiles.get(PROJECT) ?? []).toHaveLength(0);
    expect(state.projectActiveFile.get(PROJECT) ?? null).toBeNull();
  });

  it("opens a file and sets it as active", () => {
    const tab = makeTab("/src/main.rs", "fn main() {}");
    useFileViewerStore.getState().openFile(PROJECT, tab);
    const state = useFileViewerStore.getState();
    expect(state.projectOpenFiles.get(PROJECT)).toHaveLength(1);
    expect(state.projectActiveFile.get(PROJECT)).toBe("/src/main.rs");
    expect(state.projectOpenFiles.get(PROJECT)![0].content).toBe("fn main() {}");
  });

  it("opening same file twice focuses instead of duplicating", () => {
    const tab1 = makeTab("/src/main.rs", "v1");
    const tab2 = makeTab("/src/lib.ts", "v2");
    useFileViewerStore.getState().openFile(PROJECT, tab1);
    useFileViewerStore.getState().openFile(PROJECT, tab2);
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBe("/src/lib.ts");

    // Re-open first file — should not duplicate
    const tab1Updated = makeTab("/src/main.rs", "v1-updated");
    useFileViewerStore.getState().openFile(PROJECT, tab1Updated);
    const state = useFileViewerStore.getState();
    expect(state.projectOpenFiles.get(PROJECT)).toHaveLength(2);
    expect(state.projectActiveFile.get(PROJECT)).toBe("/src/main.rs");
    expect(state.projectOpenFiles.get(PROJECT)![0].content).toBe("v1-updated");
  });

  it("closes a file and cleans up state", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts", "a"));
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/b.rs", "b"));
    useFileViewerStore.getState().closeFile(PROJECT, "/b.rs");
    const state = useFileViewerStore.getState();
    expect(state.projectOpenFiles.get(PROJECT)).toHaveLength(1);
    expect(state.projectOpenFiles.get(PROJECT)![0].filePath).toBe("/a.ts");
  });

  it("closing active tab switches to last remaining tab", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/b.rs"));
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/c.py"));
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBe("/c.py");

    useFileViewerStore.getState().closeFile(PROJECT, "/c.py");
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBe("/b.rs");
  });

  it("closing last tab sets activeFilePath to null", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts"));
    useFileViewerStore.getState().closeFile(PROJECT, "/a.ts");
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBeNull();
    expect(useFileViewerStore.getState().projectOpenFiles.get(PROJECT)).toHaveLength(0);
  });

  it("dirty state is per-file", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts", "original-a"));
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/b.rs", "original-b"));

    useFileViewerStore.getState().setEditedContent(PROJECT, "/a.ts", "modified-a");
    const dirtyFiles = useFileViewerStore.getState().projectDirtyFiles.get(PROJECT)!;
    expect(dirtyFiles.has("/a.ts")).toBe(true);
    expect(dirtyFiles.has("/b.rs")).toBe(false);
  });

  it("markSaved clears dirty and updates tab content", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts", "original"));
    useFileViewerStore.getState().setEditedContent(PROJECT, "/a.ts", "modified");
    expect(useFileViewerStore.getState().projectDirtyFiles.get(PROJECT)!.has("/a.ts")).toBe(true);

    useFileViewerStore.getState().markSaved(PROJECT, "/a.ts");
    const state = useFileViewerStore.getState();
    expect(state.projectDirtyFiles.get(PROJECT)!.has("/a.ts")).toBe(false);
    expect(state.projectOpenFiles.get(PROJECT)![0].content).toBe("modified");
  });

  it("setActiveFile switches active tab", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/b.rs"));
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBe("/b.rs");

    useFileViewerStore.getState().setActiveFile(PROJECT, "/a.ts");
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBe("/a.ts");
  });

  it("setActiveFile ignores non-open paths", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts"));
    useFileViewerStore.getState().setActiveFile(PROJECT, "/nonexistent.ts");
    expect(useFileViewerStore.getState().projectActiveFile.get(PROJECT)).toBe("/a.ts");
  });

  it("closeAllFiles resets everything for project", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts"));
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/b.rs"));
    useFileViewerStore.getState().setEditedContent(PROJECT, "/a.ts", "dirty");
    useFileViewerStore.getState().closeAllFiles(PROJECT);

    const state = useFileViewerStore.getState();
    expect(state.projectOpenFiles.get(PROJECT)).toHaveLength(0);
    expect(state.projectActiveFile.get(PROJECT)).toBeNull();
    expect(state.projectEditedContents.get(PROJECT)!.size).toBe(0);
    expect(state.projectDirtyFiles.get(PROJECT)!.size).toBe(0);
  });

  it("supports diff mode", () => {
    useFileViewerStore.getState().openFile(PROJECT, {
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
    const tab = useFileViewerStore.getState().projectOpenFiles.get(PROJECT)![0];
    expect(tab.isDiff).toBe(true);
    expect(tab.oldContent).toBe("const a = 1;");
    expect(tab.newContent).toBe("const a = 2;");
  });

  it("closeFile cleans up editedContents and dirtyFiles for that path", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts", "original"));
    useFileViewerStore.getState().setEditedContent(PROJECT, "/a.ts", "modified");
    expect(useFileViewerStore.getState().projectDirtyFiles.get(PROJECT)!.has("/a.ts")).toBe(true);
    expect(useFileViewerStore.getState().projectEditedContents.get(PROJECT)!.has("/a.ts")).toBe(true);

    useFileViewerStore.getState().closeFile(PROJECT, "/a.ts");
    expect(useFileViewerStore.getState().projectDirtyFiles.get(PROJECT)!.has("/a.ts")).toBe(false);
    expect(useFileViewerStore.getState().projectEditedContents.get(PROJECT)!.has("/a.ts")).toBe(false);
  });

  it("clearProject removes all data for a project", () => {
    useFileViewerStore.getState().openFile(PROJECT, makeTab("/a.ts"));
    useFileViewerStore.getState().setEditedContent(PROJECT, "/a.ts", "dirty");
    useFileViewerStore.getState().clearProject(PROJECT);

    const state = useFileViewerStore.getState();
    expect(state.projectOpenFiles.has(PROJECT)).toBe(false);
    expect(state.projectActiveFile.has(PROJECT)).toBe(false);
    expect(state.projectEditedContents.has(PROJECT)).toBe(false);
    expect(state.projectDirtyFiles.has(PROJECT)).toBe(false);
  });

  it("isolates files between different projects", () => {
    const projectA = "/projects/a";
    const projectB = "/projects/b";
    useFileViewerStore.getState().openFile(projectA, makeTab("/a.ts", "a-content"));
    useFileViewerStore.getState().openFile(projectB, makeTab("/b.rs", "b-content"));

    expect(useFileViewerStore.getState().projectOpenFiles.get(projectA)).toHaveLength(1);
    expect(useFileViewerStore.getState().projectOpenFiles.get(projectB)).toHaveLength(1);
    expect(useFileViewerStore.getState().projectActiveFile.get(projectA)).toBe("/a.ts");
    expect(useFileViewerStore.getState().projectActiveFile.get(projectB)).toBe("/b.rs");
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
