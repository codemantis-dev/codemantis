/**
 * Tests for preview-console-bridge.js contract.
 *
 * These tests verify the structural contract of the injected preview toolbar
 * script. They read the bridge JS source and assert that critical elements
 * are present — action queue, variable names, and communication mechanisms.
 *
 * Regression: security changes repeatedly broke the preview toolbar because
 * fetch()-based callbacks were silently blocked by pages with restrictive CSP
 * (connect-src 'self'). The bridge now uses a JS action queue
 * (__CM_PENDING_ACTIONS) that the Rust polling loop drains via document.title,
 * which is immune to CSP restrictions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const bridgePath = resolve(__dirname, "../../src-tauri/resources/preview-console-bridge.js");
const bridgeSource = readFileSync(bridgePath, "utf-8");

describe("preview-console-bridge.js contract", () => {
  // ── Action queue (CSP-immune IPC) ──

  describe("action queue", () => {
    it("initializes __CM_PENDING_ACTIONS queue", () => {
      expect(bridgeSource).toContain("__CM_PENDING_ACTIONS");
    });

    it("screenshot button pushes action to queue", () => {
      expect(bridgeSource).toContain("action: 'screenshot'");
    });

    it("close button pushes action to queue", () => {
      expect(bridgeSource).toContain("action: 'close'");
    });

    it("open-in-browser button pushes action with URL", () => {
      expect(bridgeSource).toContain("action: 'open'");
    });

    it("console-to-chat button pushes action with logs", () => {
      expect(bridgeSource).toContain("action: 'console_to_chat'");
    });

    it("all four action types push to __CM_PENDING_ACTIONS", () => {
      const pushLines = bridgeSource.split("\n").filter(
        (line) => line.includes("__CM_PENDING_ACTIONS.push"),
      );
      expect(pushLines.length).toBeGreaterThanOrEqual(4);
    });

    it("does NOT use fetch() to 127.0.0.1 for toolbar actions", () => {
      const fetchToCallback = bridgeSource.split("\n").filter(
        (line) => line.includes("fetch(") && line.includes("127.0.0.1"),
      );
      expect(fetchToCallback).toHaveLength(0);
    });

    it("close button calls window.close() for immediate feedback", () => {
      expect(bridgeSource).toContain("window.close()");
    });
  });

  // ── Toolbar UI ──

  describe("toolbar", () => {
    it("creates the toolbar element", () => {
      expect(bridgeSource).toContain("__cm_toolbar");
    });

    it("has Back, Forward, Refresh navigation buttons", () => {
      expect(bridgeSource).toContain("window.history.back()");
      expect(bridgeSource).toContain("window.history.forward()");
      expect(bridgeSource).toContain("window.location.reload()");
    });

    it("has editable URL bar", () => {
      expect(bridgeSource).toContain("urlBar");
      expect(bridgeSource).toContain("type = 'text'");
    });

    it("intercepts history.pushState and replaceState for URL bar updates", () => {
      expect(bridgeSource).toContain("origPushState");
      expect(bridgeSource).toContain("origReplaceState");
    });

    it("has viewport presets (Mobile, Tablet, Desktop)", () => {
      expect(bridgeSource).toContain("'Mobile'");
      expect(bridgeSource).toContain("'Tablet'");
      expect(bridgeSource).toContain("'Desktop'");
    });
  });

  // ── Console capture ──

  describe("console capture", () => {
    it("captures console.log, warn, error, info, debug", () => {
      expect(bridgeSource).toContain("console.log =");
      expect(bridgeSource).toContain("console.warn =");
      expect(bridgeSource).toContain("console.error =");
      expect(bridgeSource).toContain("console.info =");
      expect(bridgeSource).toContain("console.debug =");
    });

    it("uses __CM_CONSOLE_BUFFER for Rust polling", () => {
      expect(bridgeSource).toContain("__CM_CONSOLE_BUFFER");
    });

    it("uses __CM_CONSOLE_LOG for local display", () => {
      expect(bridgeSource).toContain("__CM_CONSOLE_LOG");
    });

    it("limits buffer to MAX_ENTRIES", () => {
      expect(bridgeSource).toContain("MAX_ENTRIES");
      expect(bridgeSource).toContain("__CM_CONSOLE_BUFFER.shift()");
    });

    it("captures entry shape: level, ts, msg, url", () => {
      expect(bridgeSource).toContain("level: level");
      expect(bridgeSource).toContain("ts:");
      expect(bridgeSource).toContain("msg: serialize(args)");
      expect(bridgeSource).toContain("url: window.location.href");
    });

    it("captures stack trace on errors", () => {
      expect(bridgeSource).toContain("entry.stack = new Error().stack");
    });

    it("captures uncaught errors", () => {
      expect(bridgeSource).toContain("window.addEventListener('error'");
    });

    it("captures unhandled promise rejections", () => {
      expect(bridgeSource).toContain("window.addEventListener('unhandledrejection'");
    });
  });

  // ── Console drawer ──

  describe("console drawer", () => {
    it("creates the console drawer element", () => {
      expect(bridgeSource).toContain("__cm_console_drawer");
    });

    it("has a 'Send to Chat' button", () => {
      expect(bridgeSource).toContain("Send to Chat");
    });

    it("has a 'Clear' button", () => {
      expect(bridgeSource).toContain("'Clear'");
    });

    it("has a 'Copy All' button", () => {
      expect(bridgeSource).toContain("'Copy All'");
    });

    it("has a close button", () => {
      expect(bridgeSource).toContain("'Close console'");
    });

    it("is resizable via drag handle", () => {
      expect(bridgeSource).toContain("ns-resize");
    });

    it("tracks drawer open state", () => {
      expect(bridgeSource).toContain("__CM_DRAWER_OPEN");
    });

    it("has level-specific colors for entries", () => {
      expect(bridgeSource).toContain("LEVEL_COLORS");
    });
  });

  // ── IIFE guard and init ──

  describe("initialization", () => {
    it("uses IIFE guard to prevent double injection", () => {
      expect(bridgeSource).toContain("if (window.__CM_CONSOLE_BRIDGE) return;");
    });

    it("sets __CM_CONSOLE_BRIDGE flag", () => {
      expect(bridgeSource).toContain("window.__CM_CONSOLE_BRIDGE = true");
    });

    it("preserves original console methods in ORIG", () => {
      expect(bridgeSource).toContain("console.log.bind(console)");
      expect(bridgeSource).toContain("console.warn.bind(console)");
      expect(bridgeSource).toContain("console.error.bind(console)");
    });
  });

  // ── Keyboard shortcuts ──

  describe("keyboard shortcuts", () => {
    it("registers Cmd+Shift+C to toggle console drawer", () => {
      expect(bridgeSource).toContain("e.key.toLowerCase() === 'c'");
      expect(bridgeSource).toContain("toggleConsoleDrawer()");
    });
  });

  // ── Fixed element handling ──

  describe("layout", () => {
    it("pushes body content below toolbar", () => {
      expect(bridgeSource).toContain("__cm_toolbar_style");
      expect(bridgeSource).toContain("padding-top");
    });

    it("offsets fixed/sticky elements at top:0", () => {
      expect(bridgeSource).toContain("offsetFixedElements");
    });

    it("uses MutationObserver for dynamically added headers", () => {
      expect(bridgeSource).toContain("MutationObserver");
    });
  });
});
