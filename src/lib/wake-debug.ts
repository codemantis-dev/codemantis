import { invoke } from "@tauri-apps/api/core";

/**
 * Append a single breadcrumb to a category log under
 * `~/Library/Logs/CodeMantis/<category>.log`. Best-effort — failures are
 * logged but never thrown, since a missing breadcrumb must never break a
 * user-visible flow.
 *
 * Use for white-screen / wake / lifecycle diagnostics that need to survive
 * `localStorage.clear()` and force-quits. Keep lines compact: one per event.
 */
export async function appendDiagnosticLog(
  category: string,
  line: string,
): Promise<void> {
  try {
    await invoke("append_diagnostic_log", { category, line });
  } catch (e) {
    console.warn(`[wake-debug] append to ${category} failed:`, e);
  }
}

/**
 * Convenience: build a structured breadcrumb line. We avoid JSON to keep the
 * file `tail`/`grep`-friendly. Values are k=v with simple string coercion;
 * pipe-separators reserved as field delimiters.
 */
export function formatBreadcrumb(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const parts = [event];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const sv = v === null ? "null" : String(v).replace(/[|\n\r]/g, "_");
    parts.push(`${k}=${sv}`);
  }
  return parts.join(" | ");
}

/**
 * Synchronous fire-and-forget helper. Returns immediately; the await happens
 * inside a microtask. Use when you don't want to thread `await` through the
 * caller for a side-effect-only breadcrumb.
 */
export function logBreadcrumb(
  category: string,
  event: string,
  fields?: Record<string, string | number | boolean | null | undefined>,
): void {
  void appendDiagnosticLog(category, formatBreadcrumb(event, fields));
}
