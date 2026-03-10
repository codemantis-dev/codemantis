import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Blocks, Pencil, Trash2, Eye, EyeOff, Plus, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useMcpStore } from "../../stores/mcpStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { McpServerConfig, McpServerType, McpScope } from "../../types/mcp";

type ScopeFilter = "all" | "global" | "project";

interface FormState {
  name: string;
  scope: McpScope;
  serverType: McpServerType;
  command: string;
  args: string;
  env: { key: string; value: string }[];
  url: string;
  headers: { key: string; value: string }[];
}

const EMPTY_FORM: FormState = {
  name: "",
  scope: "global",
  serverType: "stdio",
  command: "",
  args: "",
  env: [],
  url: "",
  headers: [],
};

function serverToForm(server: McpServerConfig): FormState {
  return {
    name: server.name,
    scope: server.scope,
    serverType: server.serverType,
    command: server.command ?? "",
    args: server.args?.join(", ") ?? "",
    env: Object.entries(server.env ?? {}).map(([key, value]) => ({ key, value })),
    url: server.url ?? "",
    headers: Object.entries(server.headers ?? {}).map(([key, value]) => ({ key, value })),
  };
}

function formToServer(form: FormState): McpServerConfig {
  const server: McpServerConfig = {
    name: form.name.trim(),
    scope: form.scope,
    serverType: form.serverType,
  };

  if (form.serverType === "stdio") {
    server.command = form.command.trim();
    const args = form.args
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (args.length > 0) server.args = args;
    const env: Record<string, string> = {};
    for (const { key, value } of form.env) {
      if (key.trim()) env[key.trim()] = value;
    }
    if (Object.keys(env).length > 0) server.env = env;
  } else if (form.serverType === "http") {
    server.url = form.url.trim();
    const headers: Record<string, string> = {};
    for (const { key, value } of form.headers) {
      if (key.trim()) headers[key.trim()] = value;
    }
    if (Object.keys(headers).length > 0) server.headers = headers;
  } else {
    server.url = form.url.trim();
  }

  return server;
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function TypeBadge({ type }: { type: McpServerType }) {
  const colors: Record<McpServerType, string> = {
    stdio: "bg-blue-500/15 text-blue-400",
    http: "bg-green-500/15 text-green-400",
    sse: "bg-purple-500/15 text-purple-400",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${colors[type]}`}>
      {type}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: McpScope }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[11px] ${
        scope === "global"
          ? "bg-bg-elevated text-text-dim"
          : "bg-accent/10 text-accent"
      }`}
    >
      {scope === "global" ? "Global" : "Project"}
    </span>
  );
}

function KeyValueRow({
  label,
  pairs,
  onChange,
  maskValues,
}: {
  label: string;
  pairs: { key: string; value: string }[];
  onChange: (pairs: { key: string; value: string }[]) => void;
  maskValues?: boolean;
}) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const toggle = (idx: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div>
      <label className="text-ui text-text-secondary mb-1.5 block">{label}</label>
      <div className="space-y-1.5">
        {pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={pair.key}
              onChange={(e) => {
                const updated = [...pairs];
                updated[i] = { ...updated[i], key: e.target.value };
                onChange(updated);
              }}
              placeholder="Key"
              className="w-32 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            <input
              type={maskValues && !revealed.has(i) ? "password" : "text"}
              value={pair.value}
              onChange={(e) => {
                const updated = [...pairs];
                updated[i] = { ...updated[i], value: e.target.value };
                onChange(updated);
              }}
              placeholder="Value"
              className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            {maskValues && (
              <button
                type="button"
                onClick={() => toggle(i)}
                className="p-1 text-text-ghost hover:text-text-secondary transition-colors"
              >
                {revealed.has(i) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange(pairs.filter((_, j) => j !== i))}
              className="p-1 text-text-ghost hover:text-red transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...pairs, { key: "", value: "" }])}
          className="text-label text-accent hover:text-accent-light transition-colors"
        >
          + Add {label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </div>
  );
}

function ServerForm({
  form,
  onChange,
  onSave,
  onCancel,
  isEdit,
  existingNames,
  hasProject,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isEdit: boolean;
  existingNames: Set<string>;
  hasProject: boolean;
}) {
  const nameValid = form.name.trim().length > 0 && NAME_PATTERN.test(form.name.trim());
  const nameUnique = isEdit || !existingNames.has(form.name.trim());
  const hasRequired =
    form.serverType === "stdio"
      ? form.command.trim().length > 0
      : form.url.trim().length > 0;
  const canSave = nameValid && nameUnique && hasRequired;

  return (
    <div className="space-y-4">
      <h3 className="text-text-primary font-medium">
        {isEdit ? "Edit MCP Server" : "Add MCP Server"}
      </h3>

      {/* Name */}
      <div>
        <label className="text-ui text-text-secondary mb-1 block">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="my-server"
          disabled={isEdit}
          className={`w-full px-2 py-1.5 rounded bg-bg-elevated border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost ${
            isEdit ? "opacity-60 cursor-not-allowed border-border" : "border-border"
          } ${form.name.trim() && !nameValid ? "border-red/50" : ""} ${
            !nameUnique ? "border-red/50" : ""
          }`}
        />
        {form.name.trim() && !nameValid && (
          <p className="text-[11px] text-red mt-0.5">Only letters, numbers, hyphens, underscores</p>
        )}
        {!nameUnique && (
          <p className="text-[11px] text-red mt-0.5">A server with this name already exists in this scope</p>
        )}
      </div>

      {/* Scope */}
      <div>
        <label className="text-ui text-text-secondary mb-1.5 block">Scope</label>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-ui text-text-secondary cursor-pointer">
            <input
              type="radio"
              name="scope"
              checked={form.scope === "global"}
              onChange={() => onChange({ ...form, scope: "global" })}
              disabled={isEdit}
              className="accent-accent"
            />
            Global
          </label>
          {hasProject && (
            <label className="flex items-center gap-1.5 text-ui text-text-secondary cursor-pointer">
              <input
                type="radio"
                name="scope"
                checked={form.scope === "project"}
                onChange={() => onChange({ ...form, scope: "project" })}
                disabled={isEdit}
                className="accent-accent"
              />
              Project
            </label>
          )}
        </div>
      </div>

      {/* Type */}
      <div>
        <label className="text-ui text-text-secondary mb-1 block">Type</label>
        <select
          value={form.serverType}
          onChange={(e) =>
            onChange({ ...form, serverType: e.target.value as McpServerType })
          }
          className="px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </div>

      {/* Type-specific fields */}
      {form.serverType === "stdio" && (
        <div className="space-y-3 border-t border-border-light pt-3">
          <div>
            <label className="text-ui text-text-secondary mb-1 block">Command</label>
            <input
              type="text"
              value={form.command}
              onChange={(e) => onChange({ ...form, command: e.target.value })}
              placeholder="npx"
              className="w-full px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
          </div>
          <div>
            <label className="text-ui text-text-secondary mb-1 block">Arguments</label>
            <input
              type="text"
              value={form.args}
              onChange={(e) => onChange({ ...form, args: e.target.value })}
              placeholder="-y, @package/name"
              className="w-full px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            <p className="text-[11px] text-text-ghost mt-0.5">Comma-separated</p>
          </div>
          <KeyValueRow
            label="Environment Variables"
            pairs={form.env}
            onChange={(env) => onChange({ ...form, env })}
            maskValues
          />
        </div>
      )}

      {form.serverType === "http" && (
        <div className="space-y-3 border-t border-border-light pt-3">
          <div>
            <label className="text-ui text-text-secondary mb-1 block">URL</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => onChange({ ...form, url: e.target.value })}
              placeholder="https://api.example.com/mcp/"
              className="w-full px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
          </div>
          <KeyValueRow
            label="Headers"
            pairs={form.headers}
            onChange={(headers) => onChange({ ...form, headers })}
            maskValues
          />
        </div>
      )}

      {form.serverType === "sse" && (
        <div className="border-t border-border-light pt-3">
          <label className="text-ui text-text-secondary mb-1 block">URL</label>
          <input
            type="text"
            value={form.url}
            onChange={(e) => onChange({ ...form, url: e.target.value })}
            placeholder="https://mcp.example.com/sse"
            className="w-full px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!canSave}
          className={`px-4 py-1.5 rounded-lg text-ui font-medium transition-colors ${
            canSave
              ? "text-white bg-accent hover:bg-accent-light"
              : "bg-bg-elevated text-text-ghost cursor-not-allowed"
          }`}
        >
          {isEdit ? "Save Changes" : "Add Server"}
        </button>
      </div>
    </div>
  );
}

export default function McpModal() {
  const showModal = useUiStore((s) => s.showMcpModal);
  const setShowModal = useUiStore((s) => s.setShowMcpModal);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { servers, loading, error, loadServers, addServer, updateServer, removeServer } =
    useMcpStore();

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [editingServer, setEditingServer] = useState<string | null>(null); // server name or "__new__"
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revealedEnv, setRevealedEnv] = useState<Set<string>>(new Set());

  const hasProject = Boolean(activeProjectPath);

  useEffect(() => {
    if (showModal) {
      loadServers(activeProjectPath ?? undefined);
      setEditingServer(null);
      setConfirmDelete(null);
      setRevealedEnv(new Set());
    }
  }, [showModal, activeProjectPath, loadServers]);

  const filteredServers = servers.filter((s) => {
    if (scopeFilter === "all") return true;
    return s.scope === scopeFilter;
  });

  const existingNames = new Set(
    servers
      .filter((s) => s.scope === form.scope)
      .map((s) => s.name)
  );

  const handleAdd = () => {
    setForm({ ...EMPTY_FORM, scope: hasProject ? "project" : "global" });
    setEditingServer("__new__");
  };

  const handleEdit = (server: McpServerConfig) => {
    setForm(serverToForm(server));
    setEditingServer(server.name);
  };

  const handleSave = async () => {
    const server = formToServer(form);
    try {
      if (editingServer === "__new__") {
        await addServer(activeProjectPath ?? null, server);
      } else {
        await updateServer(activeProjectPath ?? null, editingServer!, server);
      }
      setEditingServer(null);
    } catch {
      // error is set in store
    }
  };

  const handleDelete = async (name: string, scope: McpScope) => {
    try {
      await removeServer(activeProjectPath ?? null, name, scope);
      setConfirmDelete(null);
    } catch {
      // error is set in store
    }
  };

  const toggleEnvReveal = (name: string) => {
    setRevealedEnv((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const serverSummary = (server: McpServerConfig): string => {
    if (server.serverType === "stdio") {
      const parts = [server.command, ...(server.args ?? [])].filter(Boolean);
      return parts.join(" ");
    }
    return server.url ?? "";
  };

  return (
    <Dialog.Root open={showModal} onOpenChange={setShowModal}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border overflow-hidden flex flex-col"
          style={{
            background: "var(--bg-primary)",
            width: "min(90vw, 640px)",
            maxHeight: "min(85vh, 600px)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
            <Dialog.Title className="flex items-center gap-2 text-text-primary font-semibold">
              <Blocks size={16} className="text-accent" />
              MCP Servers
            </Dialog.Title>
            <Dialog.Close className="text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated">
              <X size={15} />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {editingServer ? (
              <ServerForm
                form={form}
                onChange={setForm}
                onSave={handleSave}
                onCancel={() => setEditingServer(null)}
                isEdit={editingServer !== "__new__"}
                existingNames={existingNames}
                hasProject={hasProject}
              />
            ) : (
              <>
                {/* Toolbar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-1">
                    {(["all", "global", ...(hasProject ? ["project"] : [])] as ScopeFilter[]).map(
                      (f) => (
                        <button
                          key={f}
                          onClick={() => setScopeFilter(f)}
                          className={`px-2.5 py-1 rounded text-ui transition-colors ${
                            scopeFilter === f
                              ? "bg-accent/15 text-accent font-medium"
                              : "text-text-dim hover:text-text-secondary hover:bg-bg-elevated"
                          }`}
                        >
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      )
                    )}
                  </div>
                  <button
                    onClick={handleAdd}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-ui text-accent hover:bg-accent/10 transition-colors font-medium"
                  >
                    <Plus size={14} />
                    Add Server
                  </button>
                </div>

                {/* Error */}
                {error && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-red/10 border border-red/20 text-red text-ui">
                    {error}
                  </div>
                )}

                {/* Server list */}
                {loading ? (
                  <p className="text-text-dim text-ui py-8 text-center">Loading...</p>
                ) : filteredServers.length === 0 ? (
                  <p className="text-text-dim text-ui py-8 text-center">
                    {servers.length === 0
                      ? "No MCP servers configured"
                      : "No servers match this filter"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredServers.map((server) => (
                      <div
                        key={`${server.scope}-${server.name}`}
                        className="rounded-lg border border-border hover:border-border-light transition-colors"
                      >
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-mono text-ui text-text-primary font-medium truncate">
                              {server.name}
                            </span>
                            <TypeBadge type={server.serverType} />
                            <ScopeBadge scope={server.scope} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button
                              onClick={() => handleEdit(server)}
                              className="p-1.5 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                              title="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                            {confirmDelete === server.name ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(server.name, server.scope)}
                                  className="px-2 py-0.5 rounded text-[11px] text-red bg-red/10 hover:bg-red/20 transition-colors font-medium"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="px-2 py-0.5 rounded text-[11px] text-text-dim hover:bg-bg-elevated transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(server.name)}
                                className="p-1.5 rounded text-text-ghost hover:text-red hover:bg-red/10 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Summary line */}
                        <div className="px-3 pb-2 -mt-1">
                          <p className="text-[12px] text-text-dim font-mono truncate">
                            {serverSummary(server)}
                          </p>
                        </div>

                        {/* Env vars (if any) */}
                        {server.env && Object.keys(server.env).length > 0 && (
                          <div className="px-3 pb-2.5 flex flex-wrap gap-1">
                            {Object.entries(server.env).map(([key, value]) => (
                              <span
                                key={key}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-elevated text-[11px] font-mono"
                              >
                                <span className="text-text-dim">{key}=</span>
                                <span className="text-text-ghost">
                                  {revealedEnv.has(server.name) ? value : "••••••"}
                                </span>
                                <button
                                  onClick={() => toggleEnvReveal(server.name)}
                                  className="text-text-ghost hover:text-text-dim transition-colors"
                                >
                                  {revealedEnv.has(server.name) ? (
                                    <EyeOff size={10} />
                                  ) : (
                                    <Eye size={10} />
                                  )}
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!editingServer && (
            <div className="px-5 py-3 border-t border-border text-[11px] text-text-ghost shrink-0">
              Global servers: ~/.claude.json
              {hasProject && (
                <>
                  {" "}
                  &middot; Project servers: {activeProjectPath}/.mcp.json
                </>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
