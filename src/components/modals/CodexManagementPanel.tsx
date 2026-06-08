import { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { SlidersHorizontal, Server, UserCircle, ExternalLink, RefreshCw, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import {
  codexReadConfig,
  codexWriteConfigValue,
  codexListMcpStatus,
  codexReloadMcp,
  codexAccount,
  codexLogin,
  codexLogout,
  codexOpenConfigToml,
} from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
import { handleError } from "../../lib/error-handler";
import { parseMcpRows, configEntries, type McpRow } from "./codex-panel-helpers";

type Tab = "config" | "mcp" | "account";

export default function CodexManagementPanel() {
  const open = useUiStore((s) => s.showCodexPanel);
  const sessionId = useUiStore((s) => s.codexPanelSessionId);
  const initialTab = useUiStore((s) => s.codexPanelTab);
  const setShow = useUiStore((s) => s.setShowCodexPanel);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<unknown>(null);
  const [mcp, setMcp] = useState<McpRow[]>([]);
  const [account, setAccount] = useState<unknown>(null);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const load = useCallback(
    async (which: Tab) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        if (which === "config") {
          setConfig(await codexReadConfig(sessionId, false));
        } else if (which === "mcp") {
          setMcp(parseMcpRows(await codexListMcpStatus(sessionId)));
        } else {
          setAccount(await codexAccount(sessionId));
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    if (open && sessionId) void load(tab);
  }, [open, sessionId, tab, load]);

  const onClose = () => setShow(false);

  const openToml = async () => {
    try {
      await codexOpenConfigToml();
    } catch (e) {
      handleError("codex-panel: open config.toml", e);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border overflow-hidden flex flex-col"
          style={{ background: "var(--bg-primary)", width: "min(80vw, 760px)", height: "min(72vh, 620px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-light shrink-0">
            <Dialog.Title className="text-ui text-text-primary font-medium">Codex</Dialog.Title>
            <Dialog.Description className="sr-only">Codex configuration, MCP servers, and account</Dialog.Description>
            <button onClick={onClose} aria-label="Close Codex panel" className="text-text-dim hover:text-text-primary p-0.5 rounded hover:bg-bg-elevated">
              <X size={15} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border-light shrink-0">
            {([
              ["config", "Config", SlidersHorizontal],
              ["mcp", "MCP Servers", Server],
              ["account", "Account", UserCircle],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui transition-colors ${
                  tab === id ? "bg-accent/10 text-accent" : "text-text-dim hover:bg-bg-elevated"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <button onClick={() => void load(tab)} aria-label="Refresh" className="p-1.5 rounded text-text-dim hover:bg-bg-elevated" title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-4">
            {error && (
              <div className="mb-3 rounded-lg border border-red/30 bg-red/5 p-3 text-ui text-text-secondary">
                <p className="mb-2">Couldn't reach the Codex app-server for this action.</p>
                <p className="text-label text-text-dim break-all mb-2">{error}</p>
                <button onClick={openToml} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-accent border border-border hover:bg-bg-elevated">
                  <ExternalLink size={13} /> Open config.toml
                </button>
              </div>
            )}

            {tab === "config" && (
              <CodexConfigTab
                sessionId={sessionId}
                entries={configEntries(config)}
                onSaved={() => void load("config")}
                onOpenToml={openToml}
              />
            )}
            {tab === "mcp" && (
              <CodexMcpTab
                rows={mcp}
                onReload={async () => {
                  if (!sessionId) return;
                  try {
                    await codexReloadMcp(sessionId);
                    showToast("Reloading MCP servers…", "info", 3000);
                    await load("mcp");
                  } catch (e) {
                    handleError("codex-panel: reload mcp", e);
                  }
                }}
                onOpenToml={openToml}
              />
            )}
            {tab === "account" && (
              <CodexAccountTab
                account={account}
                onLogin={async () => {
                  if (!sessionId) return;
                  try {
                    await codexLogin(sessionId);
                    showToast("Opened Codex login in your browser", "info", 5000);
                  } catch (e) {
                    handleError("codex-panel: login", e);
                  }
                }}
                onLogout={async () => {
                  if (!sessionId) return;
                  try {
                    await codexLogout(sessionId);
                    showToast("Signed out of Codex", "info", 4000);
                    await load("account");
                  } catch (e) {
                    handleError("codex-panel: logout", e);
                  }
                }}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CodexConfigTab({
  sessionId,
  entries,
  onSaved,
  onOpenToml,
}: {
  sessionId: string | null;
  entries: Array<{ key: string; value: unknown; scalar: boolean }>;
  onSaved: () => void;
  onOpenToml: () => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-label text-text-dim">Live Codex config — scalars are editable; nested values edit in config.toml.</p>
        <button onClick={onOpenToml} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-accent border border-border hover:bg-bg-elevated">
          <ExternalLink size={13} /> Open config.toml
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-ui text-text-dim">No config loaded.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <ConfigRow key={e.key} sessionId={sessionId} entry={e} onSaved={onSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigRow({
  sessionId,
  entry,
  onSaved,
}: {
  sessionId: string | null;
  entry: { key: string; value: unknown; scalar: boolean };
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(entry.scalar ? String(entry.value ?? "") : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!sessionId) return;
    setSaving(true);
    try {
      // Preserve the original scalar type where possible.
      let value: unknown = draft;
      if (typeof entry.value === "number") value = Number(draft);
      else if (typeof entry.value === "boolean") value = draft === "true";
      await codexWriteConfigValue(sessionId, entry.key, value, "replace");
      showToast(`Saved ${entry.key}`, "success", 2500);
      onSaved();
    } catch (e) {
      handleError("codex-panel: write config", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 py-1 border-b border-border-light/50">
      <span className="text-ui text-text-secondary font-mono w-44 shrink-0 truncate" title={entry.key}>{entry.key}</span>
      {entry.scalar ? (
        <>
          <input
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            className="flex-1 px-2 py-1 rounded bg-bg-elevated text-ui text-text-primary border border-border focus:border-accent outline-none"
          />
          <button
            onClick={save}
            disabled={saving || draft === String(entry.value ?? "")}
            className="px-2.5 py-1 rounded text-label text-accent border border-border hover:bg-bg-elevated disabled:opacity-40"
          >
            Save
          </button>
        </>
      ) : (
        <span className="flex-1 text-label text-text-dim font-mono truncate">{JSON.stringify(entry.value)}</span>
      )}
    </div>
  );
}

function CodexMcpTab({
  rows,
  onReload,
  onOpenToml,
}: {
  rows: McpRow[];
  onReload: () => void;
  onOpenToml: () => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-label text-text-dim">Live MCP server status (auth + loaded tools).</p>
        <div className="flex gap-2">
          <button onClick={onReload} className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated">Reload</button>
          <button onClick={onOpenToml} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-accent border border-border hover:bg-bg-elevated">
            <ExternalLink size={13} /> Edit servers
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-ui text-text-dim">No MCP servers configured. Use “Edit servers” to add one in config.toml.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-bg-elevated">
              <Server size={14} className="text-text-dim shrink-0" />
              <span className="text-ui text-text-primary font-medium flex-1 truncate">{r.name}</span>
              {r.authStatus && (
                <span className="text-label px-2 py-0.5 rounded-full bg-bg-primary text-text-dim border border-border">{r.authStatus}</span>
              )}
              <span className="text-label text-text-dim">{r.toolCount} tool{r.toolCount === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodexAccountTab({
  account,
  onLogin,
  onLogout,
}: {
  account: unknown;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const a = (account as Record<string, unknown> | null) ?? {};
  const email = typeof a.email === "string" ? a.email : undefined;
  const plan = typeof a.plan === "string" ? a.plan : typeof a.planType === "string" ? (a.planType as string) : undefined;
  const loggedIn = email !== undefined || a.loggedIn === true || Object.keys(a).length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-bg-elevated p-4">
        {loggedIn ? (
          <>
            <p className="text-ui text-text-primary">{email ?? "Signed in to Codex"}</p>
            {plan && <p className="text-label text-text-dim mt-0.5">Plan: {plan}</p>}
          </>
        ) : (
          <p className="text-ui text-text-dim">Not signed in.</p>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onLogin} className="px-4 py-2 rounded-lg text-ui text-white bg-accent hover:brightness-110">Log in</button>
        <button onClick={onLogout} className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated">Log out</button>
      </div>
    </div>
  );
}
