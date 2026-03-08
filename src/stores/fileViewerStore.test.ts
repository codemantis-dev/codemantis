import { describe, it, expect, beforeEach } from "vitest";
import { useFileViewerStore, getLanguageFromPath } from "./fileViewerStore";

describe("fileViewerStore", () => {
  beforeEach(() => {
    useFileViewerStore.setState({ openFile: null });
  });

  it("starts with no file open", () => {
    expect(useFileViewerStore.getState().openFile).toBeNull();
  });

  it("sets open file", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/src/main.rs",
      fileName: "main.rs",
      language: "rust",
      extension: "rs",
      fileSize: 128,
      content: "fn main() {}",
      isDiff: false,
    });
    const file = useFileViewerStore.getState().openFile;
    expect(file).not.toBeNull();
    expect(file!.fileName).toBe("main.rs");
    expect(file!.language).toBe("rust");
    expect(file!.extension).toBe("rs");
    expect(file!.fileSize).toBe(128);
    expect(file!.content).toBe("fn main() {}");
  });

  it("closes file", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/src/main.rs",
      fileName: "main.rs",
      language: "rust",
      extension: "rs",
      fileSize: 128,
      content: "fn main() {}",
      isDiff: false,
    });
    useFileViewerStore.getState().closeFile();
    expect(useFileViewerStore.getState().openFile).toBeNull();
  });

  it("supports diff mode", () => {
    useFileViewerStore.getState().setOpenFile({
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
    const file = useFileViewerStore.getState().openFile;
    expect(file!.isDiff).toBe(true);
    expect(file!.oldContent).toBe("const a = 1;");
    expect(file!.newContent).toBe("const a = 2;");
  });

  it("replaces open file when setting new one", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/a.ts",
      fileName: "a.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 10,
      content: "a",
      isDiff: false,
    });
    useFileViewerStore.getState().setOpenFile({
      filePath: "/b.rs",
      fileName: "b.rs",
      language: "rust",
      extension: "rs",
      fileSize: 20,
      content: "b",
      isDiff: false,
    });
    expect(useFileViewerStore.getState().openFile!.fileName).toBe("b.rs");
  });

  it("stores extension and fileSize correctly", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/data/report.py",
      fileName: "report.py",
      language: "python",
      extension: "py",
      fileSize: 4096,
      content: "print('hello')",
      isDiff: false,
    });
    const file = useFileViewerStore.getState().openFile!;
    expect(file.extension).toBe("py");
    expect(file.fileSize).toBe(4096);
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
