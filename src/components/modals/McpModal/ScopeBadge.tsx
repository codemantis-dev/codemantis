import type { McpScope } from "../../../types/mcp";

export default function ScopeBadge({ scope }: { scope: McpScope }): React.JSX.Element {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-label ${
        scope === "global"
          ? "bg-bg-elevated text-text-dim"
          : "bg-accent/10 text-accent"
      }`}
    >
      {scope === "global" ? "Global" : "Project"}
    </span>
  );
}
