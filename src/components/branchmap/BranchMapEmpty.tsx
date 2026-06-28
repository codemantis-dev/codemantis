// Empty / not-ready states for the Branch Map, modeled on MissionControlEmpty.
// These double as teaching moments for vibe coders: each explains *why* you'd
// want the thing it's offering, in plain language.

import { GitBranch, FolderGit2, Save, AlertTriangle } from "lucide-react";

export type BranchMapEmptyVariant = "not-a-repo" | "no-commits" | "error";

interface BranchMapEmptyProps {
  variant: BranchMapEmptyVariant;
  projectName: string;
  /** Optional error detail (variant="error"). */
  detail?: string;
  /** Wired in Phase 5 — starts tracking (git init) / saves first checkpoint. */
  onPrimaryAction?: () => void;
  /** Whether the primary action is mid-flight. */
  actionBusy?: boolean;
}

interface VariantCopy {
  Icon: typeof GitBranch;
  iconColor: string;
  title: React.ReactNode;
  body: string;
  cta?: { label: string; Icon: typeof GitBranch };
}

export default function BranchMapEmpty({
  variant,
  projectName,
  detail,
  onPrimaryAction,
  actionBusy = false,
}: BranchMapEmptyProps): React.ReactElement {
  const accentName = (
    <span style={{ color: "var(--accent)" }}>{projectName}</span>
  );

  const copy: Record<BranchMapEmptyVariant, VariantCopy> = {
    "not-a-repo": {
      Icon: FolderGit2,
      iconColor: "var(--accent)",
      title: <>Turn on safe checkpoints for {accentName}</>,
      body:
        "Branches let you try bold changes in a safe space without risking your working project. This folder isn't tracking changes yet — turn it on and you'll get checkpoints you can always go back to.",
      cta: { label: "Start tracking changes", Icon: GitBranch },
    },
    "no-commits": {
      Icon: Save,
      iconColor: "var(--green)",
      title: <>No checkpoints yet in {accentName}</>,
      body:
        "A checkpoint is a saved snapshot of your project you can always return to. Save your first one and it'll appear here as the start of your project's timeline.",
      cta: { label: "Save your first checkpoint", Icon: Save },
    },
    error: {
      Icon: AlertTriangle,
      iconColor: "var(--red)",
      title: <>Couldn't read the branches for {accentName}</>,
      body:
        detail ??
        "Something went wrong reading this project's git history. Try refreshing — if it keeps happening, the folder may not be a git project.",
    },
  };

  const { Icon, iconColor, title, body, cta } = copy[variant];

  return (
    <div
      className="w-full h-full overflow-auto"
      style={{ background: "var(--bg-primary)" }}
      data-testid="branch-map-empty"
      data-variant={variant}
    >
      <div className="max-w-2xl mx-auto px-6 py-16 flex flex-col items-center text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <Icon size={24} style={{ color: iconColor }} />
        </div>

        <h1 className="text-xl font-semibold text-text-primary mb-2">{title}</h1>

        <p className="text-label text-text-secondary leading-relaxed max-w-lg mb-8">
          {body}
        </p>

        {cta && onPrimaryAction && (
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={actionBusy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-ui font-semibold transition-colors disabled:opacity-60"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <cta.Icon size={14} />
            {cta.label}
          </button>
        )}
      </div>
    </div>
  );
}
