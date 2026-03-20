import { useState, useEffect, useMemo, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Editor from "@monaco-editor/react";
import { Blocks, Pencil, Trash2, Eye, EyeOff, Plus, X, Wrench, Info, FileCode } from "lucide-react";
import {
  MCP_TEMPLATES,
  MCP_TEMPLATE_CATEGORIES,
  type McpTemplate,
} from "../../types/mcp-templates";
import { useUiStore } from "../../stores/uiStore";
import { useMcpStore } from "../../stores/mcpStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { getMonacoTheme } from "../../lib/editor-themes";
import { getMcpConfigPath, readFileContent, writeFileContent } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
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

function templateToForm(template: McpTemplate, scope: McpScope): FormState {
  return {
    name: template.id,
    scope,
    serverType: template.serverType,
    command: template.command ?? "",
    args: template.args?.join(", ") ?? "",
    env: Object.entries(template.env ?? {}).map(([key, value]) => ({ key, value })),
    url: template.url ?? "",
    headers: Object.entries(template.headers ?? {}).map(([key, value]) => ({ key, value })),
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
  helpText,
  pairs,
  onChange,
  maskValues,
  valuePlaceholders,
}: {
  label: string;
  helpText?: string;
  pairs: { key: string; value: string }[];
  onChange: (pairs: { key: string; value: string }[]) => void;
  maskValues?: boolean;
  valuePlaceholders?: Record<string, string>;
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
      {helpText && (
        <p className="text-[11px] text-text-ghost mb-1.5 -mt-0.5">{helpText}</p>
      )}
      <div className="space-y-1.5">
        {pairs.map((pair, i) => (
          <div key={`env-${i}-${pair.key}`} className="flex items-center gap-1.5">
            <input
              type="text"
              value={pair.key}
              title={pair.key || undefined}
              onChange={(e) => {
                const updated = [...pairs];
                updated[i] = { ...updated[i], key: e.target.value };
                onChange(updated);
              }}
              placeholder="Key"
              className="w-48 shrink-0 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            <input
              type={maskValues && !revealed.has(i) ? "password" : "text"}
              value={pair.value}
              title={maskValues ? undefined : pair.value || undefined}
              onChange={(e) => {
                const updated = [...pairs];
                updated[i] = { ...updated[i], value: e.target.value };
                onChange(updated);
              }}
              placeholder={valuePlaceholders?.[pair.key] || "Value"}
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

function TemplatePicker({
  onSelect,
  onManual,
}: {
  onSelect: (template: McpTemplate) => void;
  onManual: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-text-primary font-medium">Add MCP Server</h3>
        <p className="text-ui text-text-dim mt-0.5">
          Choose a template or configure manually
        </p>
      </div>

      {MCP_TEMPLATE_CATEGORIES.map((cat) => {
        const templates = MCP_TEMPLATES.filter((t) => t.category === cat.id);
        return (
          <div key={cat.id}>
            <h4 className="text-[11px] font-semibold text-text-dim uppercase tracking-wider mb-2">
              {cat.label}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelect(t)}
                  className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors text-left group"
                >
                  <span className="text-lg leading-none mt-0.5">{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-ui font-medium text-text-primary group-hover:text-accent transition-colors">
                        {t.displayName}
                      </span>
                      {cat.id === "api-key" && (
                        <span className="text-[10px] text-text-ghost">🔑</span>
                      )}
                      {cat.id === "cloud" && (
                        <span className="text-[10px] text-text-ghost">☁</span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-dim mt-0.5 truncate">
                      {t.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Manual Configuration */}
      <button
        onClick={onManual}
        className="w-full flex items-center gap-2.5 p-3 rounded-lg border border-dashed border-border hover:border-text-dim hover:bg-bg-elevated transition-colors text-left"
      >
        <Wrench size={16} className="text-text-dim shrink-0" />
        <div>
          <span className="text-ui font-medium text-text-secondary">
            Manual Configuration
          </span>
          <p className="text-[11px] text-text-dim mt-0.5">
            Start with a blank form
          </p>
        </div>
      </button>
    </div>
  );
}

function ConfigFileEditor({
  filePath,
  content,
  onChange,
  onSave,
  onCancel,
}: {
  filePath: string;
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const themeId = useSettingsStore((s) => s.settings.theme);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const monacoColors = useMemo(() => getMonacoTheme(themeId), [themeId]);
  const monacoThemeName = `codemantis-${themeId}`;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 400 }}>
      <div className="mb-3">
        <h3 className="text-text-primary font-medium">Edit Config File</h3>
        <p className="text-[12px] text-text-dim font-mono mt-1 truncate" title={filePath}>
          {filePath}
        </p>
      </div>

      <div className="flex-1 rounded-lg border border-border overflow-hidden">
        <Editor
          language="json"
          value={content}
          onChange={(v) => onChange(v ?? "")}
          theme={monacoThemeName}
          options={{
            fontSize,
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            automaticLayout: true,
          }}
          beforeMount={(monaco) => {
            monaco.editor.defineTheme(monacoThemeName, {
              base: monacoColors.base,
              inherit: true,
              rules: [],
              colors: {
                "editor.background": monacoColors.editorBackground,
                "editor.lineHighlightBackground": monacoColors.lineHighlightBackground,
                "editorLineNumber.foreground": monacoColors.lineNumberForeground,
                "editorLineNumber.activeForeground": monacoColors.lineNumberActiveForeground,
                "editor.selectionBackground": monacoColors.selectionBackground,
                "editorWidget.background": monacoColors.widgetBackground,
                "editorWidget.border": monacoColors.widgetBorder,
              },
            });
          }}
        />
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          className="px-4 py-1.5 rounded-lg text-ui font-medium text-white bg-accent hover:bg-accent-light transition-colors"
        >
          Save
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
  onShowConfigFile,
  isEdit,
  existingNames,
  hasProject,
  setupHint,
  fieldHints,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  onShowConfigFile?: () => void;
  isEdit: boolean;
  existingNames: Set<string>;
  hasProject: boolean;
  setupHint?: string;
  fieldHints?: Record<string, string>;
}) {
  const nameValid = form.name.trim().length > 0 && NAME_PATTERN.test(form.name.trim());
  const nameUnique = isEdit || !existingNames.has(form.name.trim());
  const hasRequired =
    form.serverType === "stdio"
      ? form.command.trim().length > 0
      : form.url.trim().length > 0;
  const canSave = nameValid && nameUnique && hasRequired;

  const typeDescriptions: Record<McpServerType, string> = {
    stdio: "Runs a local process on your machine. Communicates via stdin/stdout.",
    http: "Connects to a remote HTTP endpoint. Used for cloud-hosted MCP servers.",
    sse: "Server-Sent Events (legacy). Prefer HTTP for new servers.",
  };

  return (
    <div className="space-y-4">
      <h3 className="text-text-primary font-medium">
        {isEdit ? "Edit MCP Server" : "Add MCP Server"}
      </h3>

      {/* Setup hint from template */}
      {setupHint && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-accent/8 border border-accent/15">
          <Info size={14} className="text-accent shrink-0 mt-0.5" />
          <p className="text-[12px] text-text-secondary leading-relaxed">{setupHint}</p>
        </div>
      )}

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
        {form.name.trim() && !nameValid ? (
          <p className="text-[11px] text-red mt-0.5">Only letters, numbers, hyphens, underscores</p>
        ) : !nameUnique ? (
          <p className="text-[11px] text-red mt-0.5">A server with this name already exists in this scope</p>
        ) : (
          <p className="text-[11px] text-text-ghost mt-0.5">Unique identifier used as the key in your config file</p>
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
        <p className="text-[11px] text-text-ghost mt-1">
          Global: ~/.claude.json (all projects). Project: .mcp.json (this project only).
        </p>
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
        <p className="text-[11px] text-text-ghost mt-0.5">{typeDescriptions[form.serverType]}</p>
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
            <p className="text-[11px] text-text-ghost mt-0.5">Executable to run (npx, node, python, etc.)</p>
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
            <p className="text-[11px] text-text-ghost mt-0.5">Comma-separated arguments passed to the command</p>
          </div>
          <KeyValueRow
            label="Environment Variables"
            helpText="Passed to the server process at startup"
            pairs={form.env}
            onChange={(env) => onChange({ ...form, env })}
            maskValues
            valuePlaceholders={fieldHints}
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
            <p className="text-[11px] text-text-ghost mt-0.5">The HTTP endpoint of the remote MCP server</p>
          </div>
          <KeyValueRow
            label="Headers"
            helpText="HTTP headers sent with each request to the server"
            pairs={form.headers}
            onChange={(headers) => onChange({ ...form, headers })}
            maskValues
            valuePlaceholders={fieldHints}
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
          <p className="text-[11px] text-text-ghost mt-0.5">The SSE endpoint of the remote MCP server (legacy protocol)</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        {onShowConfigFile && (
          <button
            onClick={onShowConfigFile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors mr-auto"
          >
            <FileCode size={13} />
            Show config file
          </button>
        )}
        <div className="flex gap-2 ml-auto">
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
  const [setupHint, setSetupHint] = useState("");
  const [fieldHints, setFieldHints] = useState<Record<string, string>>({});
  const [configEditor, setConfigEditor] = useState<{
    filePath: string;
    originalContent: string;
    editedContent: string;
    scope: McpScope;
  } | null>(null);

  const hasProject = Boolean(activeProjectPath);

  useEffect(() => {
    if (showModal) {
      loadServers(activeProjectPath ?? undefined);
      setEditingServer(null);
      setConfirmDelete(null);
      setRevealedEnv(new Set());
      setConfigEditor(null);
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
    setEditingServer("__picking__");
  };

  const handleSelectTemplate = (template: McpTemplate) => {
    const scope = hasProject ? "project" : "global";
    setForm(templateToForm(template, scope));
    setSetupHint(template.setupHint ?? "");
    setFieldHints(template.fieldHints ? { ...template.fieldHints } : {});
    setEditingServer("__new__");
  };

  const handleManualAdd = () => {
    setForm({ ...EMPTY_FORM, scope: hasProject ? "project" : "global" });
    setSetupHint("");
    setFieldHints({});
    setEditingServer("__new__");
  };

  const handleEdit = (server: McpServerConfig) => {
    setForm(serverToForm(server));
    setSetupHint("");
    setFieldHints({});
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

  const handleShowConfigFile = useCallback(async (scope: McpScope) => {
    try {
      const filePath = await getMcpConfigPath(scope, activeProjectPath ?? undefined);
      const content = await readFileContent(filePath);
      setConfigEditor({
        filePath,
        originalContent: content,
        editedContent: content,
        scope,
      });
    } catch (err) {
      showToast(`Failed to open config file: ${err}`, "error");
    }
  }, [activeProjectPath]);

  const handleSaveConfigFile = useCallback(async () => {
    if (!configEditor) return;
    try {
      JSON.parse(configEditor.editedContent);
    } catch {
      showToast("Invalid JSON — please fix syntax errors before saving", "error");
      return;
    }
    try {
      await writeFileContent(configEditor.filePath, configEditor.editedContent);
      await loadServers(activeProjectPath ?? undefined);
      setConfigEditor(null);
      setEditingServer(null);
      showToast("Config file saved", "success");
    } catch (err) {
      showToast(`Failed to save config file: ${err}`, "error");
    }
  }, [configEditor, activeProjectPath, loadServers]);

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
            width: "min(90vw, 780px)",
            height: "min(85vh, 720px)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
            <Dialog.Title className="flex items-center gap-2 text-text-primary font-semibold">
              <Blocks size={16} className="text-accent" />
              MCP Servers
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close MCP servers dialog"
              className="text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Manage MCP server configurations
          </Dialog.Description>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {configEditor ? (
              <ConfigFileEditor
                filePath={configEditor.filePath}
                content={configEditor.editedContent}
                onChange={(content) =>
                  setConfigEditor((prev) => prev ? { ...prev, editedContent: content } : null)
                }
                onSave={handleSaveConfigFile}
                onCancel={() => setConfigEditor(null)}
              />
            ) : editingServer === "__picking__" ? (
              <TemplatePicker
                onSelect={handleSelectTemplate}
                onManual={handleManualAdd}
              />
            ) : editingServer ? (
              <ServerForm
                form={form}
                onChange={setForm}
                onSave={handleSave}
                onCancel={() =>
                  setEditingServer(
                    editingServer === "__new__" ? "__picking__" : null
                  )
                }
                onShowConfigFile={() => handleShowConfigFile(form.scope)}
                isEdit={editingServer !== "__new__"}
                existingNames={existingNames}
                hasProject={hasProject}
                setupHint={setupHint}
                fieldHints={fieldHints}
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
