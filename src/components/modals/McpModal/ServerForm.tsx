import { useCallback } from "react";
import { Info, FileCode, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { McpServerType } from "../../../types/mcp";
import type { FormState } from "./types";
import { NAME_PATTERN } from "./types";
import KeyValueRow from "./KeyValueRow";

export default function ServerForm({
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
  templateDisplayName,
  docsUrl,
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
  templateDisplayName?: string;
  docsUrl?: string;
}): React.JSX.Element {
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

  const handleEnvChange = useCallback(
    (env: { key: string; value: string }[]) => onChange({ ...form, env }),
    [onChange, form],
  );

  const handleHeadersChange = useCallback(
    (headers: { key: string; value: string }[]) => onChange({ ...form, headers }),
    [onChange, form],
  );

  return (
    <div className="space-y-4">
      {(templateDisplayName || docsUrl) && (
        <div className="flex items-center justify-between">
          {templateDisplayName && (
            <span className="text-ui text-text-dim">
              Template: {templateDisplayName}
            </span>
          )}
          {docsUrl && (
            <button
              onClick={() => openUrl(docsUrl)}
              className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-light transition-colors ml-auto"
            >
              <ExternalLink size={11} />
              Docs
            </button>
          )}
        </div>
      )}

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
            onChange={handleEnvChange}
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
            onChange={handleHeadersChange}
            maskValues
            valuePlaceholders={fieldHints}
          />
        </div>
      )}

      {form.serverType === "sse" && (
        <div className="space-y-3 border-t border-border-light pt-3">
          <div>
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
          <KeyValueRow
            label="Headers"
            helpText="HTTP headers sent with each request to the server"
            pairs={form.headers}
            onChange={handleHeadersChange}
            maskValues
            valuePlaceholders={fieldHints}
          />
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
