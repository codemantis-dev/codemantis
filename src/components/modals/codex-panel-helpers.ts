//! Pure parsing helpers for CodexManagementPanel. Kept in a separate
//! module so the component file only exports a component (react-refresh)
//! and the helpers stay independently unit-testable.

/** A row in the MCP tab — defensively parsed from `mcpServerStatus/list`. */
export interface McpRow {
  name: string;
  authStatus?: string;
  toolCount: number;
}

/** Pull MCP rows out of an arbitrary `{ data: [...] }` blob without
 * assuming field presence (the Codex shape evolves between versions). */
export function parseMcpRows(resp: unknown): McpRow[] {
  const data = (resp as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((entry) => {
    const e = entry as Record<string, unknown>;
    const tools = e.tools;
    const toolCount =
      tools && typeof tools === "object" ? Object.keys(tools as object).length : 0;
    return {
      name: typeof e.name === "string" ? e.name : "(unnamed)",
      authStatus: typeof e.authStatus === "string" ? e.authStatus : undefined,
      toolCount,
    };
  });
}

/** Flatten the top-level config object into displayable entries. Scalars
 * are inline-editable; objects/arrays are shown as JSON (edit via
 * config.toml). `config` is `additionalProperties` so never hardcode keys. */
export function configEntries(
  resp: unknown
): Array<{ key: string; value: unknown; scalar: boolean }> {
  const config = (resp as { config?: unknown } | null)?.config;
  if (!config || typeof config !== "object") return [];
  return Object.entries(config as Record<string, unknown>)
    .map(([key, value]) => ({
      key,
      value,
      scalar:
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
