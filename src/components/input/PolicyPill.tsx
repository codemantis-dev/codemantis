import { useEffect, useRef, useState } from "react";

import type {
  CodexApproval,
  CodexSandbox,
  CodexSessionPolicy,
} from "../../lib/tauri-commands";
import { setCodexPolicy } from "../../lib/tauri-commands";

/**
 * Phase 2 §6.1 — Policy pill. Replaces the Claude `ModeSelector` for
 * Codex sessions. Codex doesn't have a single "mode" axis: sandbox and
 * approval policy are orthogonal, so the pill surfaces both and stores
 * them as one `CodexSessionPolicy` object.
 *
 * Behaviour:
 * - Renders the active sandbox + approval as a compact pill ("workspace-
 *   write · on-request ▾").
 * - Clicking opens a popover with radio groups for sandbox / approval.
 * - Changes commit immediately via `setCodexPolicy` and update local
 *   state optimistically. On failure, the previous value is restored
 *   and a no-op happens (parent's toast layer handles user feedback).
 * - Network-access toggle is a read-only indicator in v1.3.0 — flipping
 *   it requires editing `~/.codex/config.toml` (gated by the
 *   `codex_network_access` Preflight recipe).
 */
export interface PolicyPillProps {
  sessionId: string;
  value: CodexSessionPolicy;
  onChange: (next: CodexSessionPolicy) => void;
  /** Optional override for the IPC commit (tests inject a stub). */
  commit?: (sessionId: string, next: CodexSessionPolicy) => Promise<void>;
}

const SANDBOX_OPTIONS: { value: CodexSandbox; label: string; description: string }[] = [
  {
    value: "read-only",
    label: "Read-only",
    description: "Agent can read but cannot write or run mutating commands.",
  },
  {
    value: "workspace-write",
    label: "Workspace-write",
    description: "Writes inside the project; protected paths (.git, .codex, .agents) stay read-only.",
  },
  {
    value: "danger-full-access",
    label: "Danger: full access",
    description: "No sandbox at all. Use only for trusted scripts.",
  },
];

const APPROVAL_OPTIONS: { value: CodexApproval; label: string; description: string }[] = [
  {
    value: "never",
    label: "Never",
    description: "Skip all prompts. Pair with a strict sandbox.",
  },
  {
    value: "on-request",
    label: "On request",
    description: "Codex asks before sandboxed-block commands or anything outside the trusted set.",
  },
  {
    value: "untrusted",
    label: "Untrusted",
    description: "Mutations always require approval; reads run automatically.",
  },
];

function summary(p: CodexSessionPolicy): string {
  return `${p.sandbox} · ${p.approval}`;
}

export default function PolicyPill({
  sessionId,
  value,
  onChange,
  commit = setCodexPolicy,
}: PolicyPillProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const apply = (next: CodexSessionPolicy): void => {
    onChange(next); // optimistic
    void commit(sessionId, next).catch(() => {
      // revert on failure — caller's toast layer surfaces the error
      onChange(value);
    });
  };

  return (
    <div className="relative inline-block" data-testid="policy-pill">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-label px-3 py-1 rounded-md border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="policy-pill-trigger"
      >
        Policy: <span className="text-text-primary">{summary(value)}</span>
        <span className="ml-1">▾</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-2 w-80 rounded-lg border border-border bg-bg shadow-lg p-3 z-50"
          role="dialog"
          aria-label="Codex policy"
          data-testid="policy-pill-popover"
        >
          <PolicySection
            heading="Sandbox"
            options={SANDBOX_OPTIONS}
            value={value.sandbox}
            onSelect={(s) => apply({ ...value, sandbox: s })}
          />
          <div className="my-3 border-t border-border-light" />
          <PolicySection
            heading="Approval policy"
            options={APPROVAL_OPTIONS}
            value={value.approval}
            onSelect={(a) => apply({ ...value, approval: a })}
          />
          <div className="my-3 border-t border-border-light" />
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-label text-text-secondary">Network access</div>
              <div className="text-label text-text-ghost">
                {value.network_access
                  ? "Allowed (configured in ~/.codex/config.toml)"
                  : "Disabled — edit ~/.codex/config.toml + Preflight to enable"}
              </div>
            </div>
            <span
              className={`text-label px-2 py-0.5 rounded-md ${
                value.network_access
                  ? "bg-accent-dim text-accent"
                  : "bg-bg-elevated text-text-ghost"
              }`}
            >
              {value.network_access ? "on" : "off"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface PolicySectionProps<T extends string> {
  heading: string;
  options: { value: T; label: string; description: string }[];
  value: T;
  onSelect: (next: T) => void;
}

function PolicySection<T extends string>({
  heading,
  options,
  value,
  onSelect,
}: PolicySectionProps<T>): React.ReactElement {
  return (
    <div>
      <div className="text-label text-text-secondary mb-1">{heading}</div>
      <div className="flex flex-col gap-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex items-start gap-2 px-2 py-1 rounded-md cursor-pointer ${
              value === o.value ? "bg-accent-dim" : "hover:bg-bg-elevated"
            }`}
          >
            <input
              type="radio"
              name={`policy-${heading}`}
              value={o.value}
              checked={value === o.value}
              onChange={() => onSelect(o.value)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-label text-text-primary">{o.label}</div>
              <div className="text-label text-text-ghost">{o.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
