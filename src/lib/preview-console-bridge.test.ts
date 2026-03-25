/**
 * Tests for preview-console-bridge.js contract.
 *
 * These tests verify the structural contract of the injected preview toolbar
 * script. They read the bridge JS source and assert that critical elements
 * are present — fetch endpoints, variable names, and fallback behavior.
 *
 * Regression: security changes repeatedly broke the preview toolbar because
 * the callback port injection, fetch endpoints, or CORS headers were
 * silently changed. These tests catch such regressions at build time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read the bridge JS source once for all tests
const bridgePath = resolve(__dirname, "../../src-tauri/resources/preview-console-bridge.js");
const bridgeSource = readFileSync(bridgePath, "utf-8");

describe("preview-console-bridge.js contract", () => {
  // ── Callback port variable ──

  it("references window.__CM_CALLBACK_PORT for toolbar buttons", () => {
    // All toolbar buttons check this variable before making fetch calls.
    // If the variable name changes, the port injection in open_preview_window
    // (which prepends "window.__CM_CALLBACK_PORT = {port}") will silently break.
    expect(bridgeSource).toContain("window.__CM_CALLBACK_PORT");
  });

  it("checks __CM_CALLBACK_PORT before every fetch call", () => {
    // Each button handler must guard on the port being set
    const portChecks = bridgeSource.match(/window\.__CM_CALLBACK_PORT/g);
    // At minimum: screenshot button (2: check + retry), close button (1),
    // console-to-chat (1), open-in-browser (1) = 5+ references
    expect(portChecks!.length).toBeGreaterThanOrEqual(5);
  });

  // ── HTTP callback endpoints ──

  it("contains fetch to /screenshot endpoint", () => {
    expect(bridgeSource).toContain("'/screenshot'");
  });

  it("contains fetch to /close endpoint", () => {
    expect(bridgeSource).toContain("'/close'");
  });

  it("contains fetch to /console-to-chat endpoint", () => {
    expect(bridgeSource).toContain("'/console-to-chat'");
  });

  it("contains fetch to /open endpoint", () => {
    expect(bridgeSource).toContain("'/open'");
  });

  // ── Fetch target address ──

  it("all fetch calls target 127.0.0.1 (not localhost)", () => {
    // The approval server binds to 127.0.0.1:0. If fetches target "localhost"
    // instead, CORS or DNS resolution issues can break the callbacks.
    const fetchLines = bridgeSource.split("\n").filter(
      (line) => line.includes("fetch(") && line.includes("port"),
    );
    expect(fetchLines.length).toBeGreaterThan(0);
    for (const line of fetchLines) {
      expect(line).toContain("127.0.0.1");
    }
  });

  // ── Close button fallback ──

  it("close button falls back to window.close() when port unavailable", () => {
    // When __CM_CALLBACK_PORT is undefined, the close button must still
    // close the window via the direct window.close() API.
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
    // The bridge must check __CM_CONSOLE_BRIDGE to avoid injecting twice
    // on SPA navigation or re-injection.
    expect(bridgeSource).toContain("if (window.__CM_CONSOLE_BRIDGE) return;");
  });

  // ── POST method on all callback fetches ──

  it("uses POST method for all callback fetches", () => {
    // The approval server only accepts POST for callback endpoints.
    // GET would return 405 and silently break the buttons.
    const fetchCalls = bridgeSource.split("\n").filter(
      (line) => line.includes("fetch(") && line.includes("127.0.0.1"),
    );
    for (const line of fetchCalls) {
      // The method: 'POST' is on the same or next line
      const idx = bridgeSource.indexOf(line);
      const context = bridgeSource.substring(idx, idx + 200);
      expect(context).toContain("POST");
    }
  });

  // ── console-to-chat sends JSON body ──

  it("console-to-chat sends JSON Content-Type with logs payload", () => {
    // The /console-to-chat endpoint expects { logs: string } as JSON.
    // Missing Content-Type triggers a CORS preflight that would fail
    // if the server doesn't handle OPTIONS for this endpoint.
    const consoleToChat = bridgeSource.substring(
      bridgeSource.indexOf("'/console-to-chat'") - 200,
      bridgeSource.indexOf("'/console-to-chat'") + 200,
    );
    expect(consoleToChat).toContain("application/json");
    expect(consoleToChat).toContain("JSON.stringify");
  });
});
