import { useMemo } from "react";

interface ApprovalSummaryProps {
  toolName: string;
  toolInput: Record<string, unknown> | null | undefined;
}

const MAX_DIFF_LINES = 12;
const MAX_BLOCK_LINES = 8;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNonEmptyString(v: unknown): string | null {
  const s = asString(v);
  return s && s.trim().length > 0 ? s : null;
}

function truncateLines(text: string, max: number): { lines: string[]; hiddenCount: number } {
  const lines = text.split("\n");
  if (lines.length <= max) return { lines, hiddenCount: 0 };
  return { lines: lines.slice(0, max), hiddenCount: lines.length - max };
}

function DiffBlock({ diff }: { diff: string }) {
  const { lines, hiddenCount } = truncateLines(diff, MAX_DIFF_LINES);
  return (
    <div className="font-mono text-label">
      {lines.map((line, i) => {
        let color = "text-text-dim";
        if (line.startsWith("+") && !line.startsWith("+++")) color = "text-green";
        else if (line.startsWith("-") && !line.startsWith("---")) color = "text-red";
        else if (line.startsWith("@@")) color = "text-accent";
        return (
          <div key={i} className={`${color} whitespace-pre-wrap break-all`}>
            {line || " "}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div className="text-text-faint italic mt-1">… {hiddenCount} more line{hiddenCount === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

function CodeBlock({ text, label }: { text: string; label?: string }) {
  const { lines, hiddenCount } = truncateLines(text, MAX_BLOCK_LINES);
  return (
    <div>
      {label && <div className="text-label text-text-faint mb-1">{label}</div>}
      <pre className="text-label font-mono text-text-dim whitespace-pre-wrap break-all">
        {lines.join("\n")}
      </pre>
      {hiddenCount > 0 && (
        <div className="text-label text-text-faint italic mt-1">… {hiddenCount} more line{hiddenCount === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

function LabeledLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-label">
      <span className="text-text-faint shrink-0">{label}:</span>
      <span className={`text-text-primary break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function BashSummary({ input }: { input: Record<string, unknown> }) {
  const command = asString(input.command);
  const cwd = asString(input.cwd);
  // Codex sends `reason`, Claude sends `description` — surface whichever is present.
  const note = asNonEmptyString(input.reason) ?? asNonEmptyString(input.description);
  return (
    <div className="flex flex-col gap-2">
      {command ? (
        <div className="rounded bg-bg-primary p-2 font-mono text-label text-text-primary whitespace-pre-wrap break-all">
          $ {command}
        </div>
      ) : (
        <div className="text-label text-text-faint italic">No command supplied.</div>
      )}
      {cwd && <LabeledLine label="cwd" value={cwd} mono />}
      {note && (
        <div className="text-label text-text-secondary whitespace-pre-wrap">{note}</div>
      )}
    </div>
  );
}

function ClaudeEditSummary({ input }: { input: Record<string, unknown> }) {
  const filePath = asString(input.file_path);
  const oldStr = typeof input.old_string === "string" ? input.old_string : "";
  const newStr = typeof input.new_string === "string" ? input.new_string : "";
  return (
    <div className="flex flex-col gap-2">
      {filePath && <LabeledLine label="file" value={filePath} mono />}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-red/30 bg-red/5 p-2">
          <CodeBlock text={oldStr} label="before" />
        </div>
        <div className="rounded border border-green/30 bg-green/5 p-2">
          <CodeBlock text={newStr} label="after" />
        </div>
      </div>
    </div>
  );
}

function ClaudeWriteSummary({ input }: { input: Record<string, unknown> }) {
  const filePath = asString(input.file_path);
  const content = typeof input.content === "string" ? input.content : "";
  return (
    <div className="flex flex-col gap-2">
      {filePath && <LabeledLine label="file" value={filePath} mono />}
      <LabeledLine label="size" value={`${content.length} chars`} />
      <CodeBlock text={content} label="content (preview)" />
    </div>
  );
}

function ClaudeReadSummary({ input }: { input: Record<string, unknown> }) {
  const filePath = asString(input.file_path);
  const offset = typeof input.offset === "number" ? input.offset : null;
  const limit = typeof input.limit === "number" ? input.limit : null;
  return (
    <div className="flex flex-col gap-2">
      {filePath && <LabeledLine label="file" value={filePath} mono />}
      {(offset !== null || limit !== null) && (
        <LabeledLine
          label="range"
          value={`lines ${offset ?? 1}${limit !== null ? `–${(offset ?? 1) + limit - 1}` : "+"}`}
        />
      )}
    </div>
  );
}

function CodexFileChangeSummary({ input }: { input: Record<string, unknown> }) {
  const path = asString(input.path);
  const diff = typeof input.diff === "string" ? input.diff : null;
  return (
    <div className="flex flex-col gap-2">
      {path && <LabeledLine label="file" value={path} mono />}
      {diff && (
        <div className="rounded bg-bg-primary p-2 max-h-[140px] overflow-y-auto">
          <DiffBlock diff={diff} />
        </div>
      )}
    </div>
  );
}

interface FileChange {
  type?: string;
  // other fields ignored for the v1 list view
}

function CodexApplyPatchSummary({ input }: { input: Record<string, unknown> }) {
  const fileChanges = (input.fileChanges && typeof input.fileChanges === "object")
    ? (input.fileChanges as Record<string, FileChange>)
    : {};
  const entries = Object.entries(fileChanges);
  const reason = asNonEmptyString(input.reason);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-label text-text-faint">
        {entries.length} file{entries.length === 1 ? "" : "s"} to change:
      </div>
      <ul className="flex flex-col gap-1">
        {entries.map(([path, change]) => {
          const action = (change?.type ?? "modify").toLowerCase();
          const actionColor =
            action === "add" ? "text-green" :
            action === "delete" || action === "remove" ? "text-red" :
            "text-accent";
          return (
            <li key={path} className="flex gap-2 text-label font-mono">
              <span className={`${actionColor} uppercase shrink-0 w-12`}>{action}</span>
              <span className="text-text-primary break-all">{path}</span>
            </li>
          );
        })}
      </ul>
      {reason && (
        <div className="text-label text-text-secondary whitespace-pre-wrap mt-1">{reason}</div>
      )}
    </div>
  );
}

function PermissionRequestSummary({ input }: { input: Record<string, unknown> }) {
  const perms = (input.permissions && typeof input.permissions === "object" && !Array.isArray(input.permissions))
    ? (input.permissions as Record<string, unknown>)
    : null;
  const entries = perms ? Object.entries(perms) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-label text-text-primary">Codex requests these permissions:</div>
      {entries.length === 0 ? (
        <div className="text-label text-text-faint italic">No permissions listed.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map(([key, value]) => (
            <li key={key} className="flex gap-2 text-label font-mono">
              <span className="text-accent shrink-0">{key}:</span>
              <span className="text-text-primary break-all">{JSON.stringify(value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function McpElicitationSummary({ toolName, input }: { toolName: string; input: Record<string, unknown> }) {
  // toolName is "mcp__{server}__elicitation"
  const parts = toolName.split("__");
  const server = parts.length >= 2 ? parts[1] : "MCP server";
  const mode = asString(input.mode) ?? "form";
  const schema = (input.schema && typeof input.schema === "object")
    ? (input.schema as Record<string, unknown>)
    : null;
  const requiredFields: string[] = Array.isArray(schema?.required)
    ? (schema!.required as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const properties = (schema?.properties && typeof schema.properties === "object")
    ? Object.keys(schema.properties as Record<string, unknown>)
    : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-label text-text-primary">
        <span className="font-medium">{server}</span> is asking for input
      </div>
      <LabeledLine label="mode" value={mode} />
      {properties.length > 0 && (
        <div className="text-label text-text-secondary">
          <span className="text-text-faint">fields: </span>
          {properties.map((p, i) => (
            <span key={p} className="font-mono">
              {p}{requiredFields.includes(p) ? " *" : ""}{i < properties.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FallbackSummary({ input }: { input: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(input ?? {}, null, 2);
    } catch {
      return String(input);
    }
  }, [input]);
  return (
    <pre className="text-label text-text-dim font-mono whitespace-pre-wrap break-all">
      {text}
    </pre>
  );
}

export default function ApprovalSummary({ toolName, toolInput }: ApprovalSummaryProps) {
  const input = (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput))
    ? toolInput
    : {};

  // Match by toolName + shape — Codex and Claude share names ("Bash", "Edit")
  // but differ on field names, so each branch inspects the input shape it
  // knows about. Unknown shapes fall through to the JSON fallback.
  if (toolName === "Bash") {
    return <BashSummary input={input} />;
  }
  if (toolName === "Edit") {
    // Codex applyPatchApproval → fileChanges
    if (input.fileChanges && typeof input.fileChanges === "object") {
      return <CodexApplyPatchSummary input={input} />;
    }
    // Codex fileChange → path + diff
    if (typeof input.path === "string" && typeof input.diff === "string") {
      return <CodexFileChangeSummary input={input} />;
    }
    // Claude Edit → file_path + old_string + new_string
    if (typeof input.file_path === "string") {
      return <ClaudeEditSummary input={input} />;
    }
  }
  if (toolName === "Write" && typeof input.file_path === "string") {
    return <ClaudeWriteSummary input={input} />;
  }
  if (toolName === "Read" && typeof input.file_path === "string") {
    return <ClaudeReadSummary input={input} />;
  }
  if (toolName === "PermissionRequest") {
    return <PermissionRequestSummary input={input} />;
  }
  if (toolName.startsWith("mcp__") && toolName.endsWith("__elicitation")) {
    return <McpElicitationSummary toolName={toolName} input={input} />;
  }

  return <FallbackSummary input={input} />;
}
