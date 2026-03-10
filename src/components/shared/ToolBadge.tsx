import { getActivityType } from "../../types/activity";

interface ToolBadgeProps {
  toolName: string;
}

const badgeConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  read: { label: "RE", color: "var(--tool-read)", bg: "rgba(96,165,250,0.12)" },
  write: { label: "WR", color: "var(--tool-write)", bg: "rgba(52,211,153,0.12)" },
  edit: { label: "ED", color: "var(--tool-edit)", bg: "rgba(251,191,36,0.12)" },
  bash: { label: "BA", color: "var(--tool-bash)", bg: "rgba(192,132,252,0.12)" },
  task: { label: "TD", color: "var(--tool-read)", bg: "rgba(96,165,250,0.12)" },
  search: { label: "SR", color: "var(--tool-bash)", bg: "rgba(192,132,252,0.12)" },
  agent: { label: "AG", color: "var(--tool-write)", bg: "rgba(52,211,153,0.12)" },
  other: { label: "??", color: "var(--text-dim)", bg: "rgba(255,255,255,0.06)" },
};

export default function ToolBadge({ toolName }: ToolBadgeProps) {
  const activityType = getActivityType(toolName);
  const config = badgeConfig[activityType];

  return (
    <span
      className="inline-flex items-center justify-center rounded font-mono text-[10px] font-bold leading-none"
      style={{
        color: config.color,
        backgroundColor: config.bg,
        width: 24,
        height: 18,
      }}
    >
      {config.label}
    </span>
  );
}
