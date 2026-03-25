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

// Read the bridge JS source once for all tests
const bridgePath = resolve(__dirname, "../../src-tauri/resources/preview-console-bridge.js");
const bridgeSource = readFileSync(bridgePath, "utf-8");

describe("preview-console-bridge.js contract", () => {
  // ── Action queue (CSP-immune IPC) ──

  it("initializes __CM_PENDING_ACTIONS queue", () => {
    // All toolbar actions push to this queue instead of calling fetch(),
    // which is blocked by CSP connect-src restrictions on loaded pages.
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

  // ── No fetch() to callback server ──

  it("does NOT use fetch() to 127.0.0.1 for toolbar actions", () => {
    // CSP blocks fetch to non-self origins. The bridge must use the action
    // queue mechanism, not fetch(). This is THE critical regression guard.
    const fetchToCallback = bridgeSource.split("\n").filter(
      (line) => line.includes("fetch(") && line.includes("127.0.0.1"),
    );
    expect(fetchToCallback).toHaveLength(0);
  });

  // ── Close button ──

  it("close button calls window.close() for immediate feedback", () => {
    expect(bridgeSource).toContain("window.close()");
  });

  // ── Toolbar and drawer presence ──

  it("creates the toolbar element", () => {
    expect(bridgeSource).toContain("__cm_toolbar");
  });

  it("creates the console drawer element", () => {
    expect(bridgeSource).toContain("__cm_console_drawer");
  });

  it("has a 'Send to Chat' button in the console drawer", () => {
    expect(bridgeSource).toContain("Send to Chat");
  });

  // ── Console capture ──

  it("captures console.log, warn, error, info, debug", () => {
    expect(bridgeSource).toContain("console.log =");
    expect(bridgeSource).toContain("console.warn =");
    expect(bridgeSource).toContain("console.error =");
    expect(bridgeSource).toContain("console.info =");
    expect(bridgeSource).toContain("console.debug =");
  });

  it("uses __CM_CONSOLE_BUFFER for captured entries", () => {
    expect(bridgeSource).toContain("__CM_CONSOLE_BUFFER");
  });

  // ── IIFE guard ──

  it("uses IIFE guard to prevent double injection", () => {
    expect(bridgeSource).toContain("if (window.__CM_CONSOLE_BRIDGE) return;");
  });

  // ── Action queue push pattern ──

  it("all four action types push to __CM_PENDING_ACTIONS", () => {
    // Each toolbar button must use the same push pattern
    const pushLines = bridgeSource.split("\n").filter(
      (line) => line.includes("__CM_PENDING_ACTIONS.push"),
    );
    // screenshot, close, open, console_to_chat = 4 push calls
    expect(pushLines.length).toBeGreaterThanOrEqual(4);
  });
});
