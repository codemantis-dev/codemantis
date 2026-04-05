import type { McpServerType } from "../../../types/mcp";

export default function TypeBadge({ type }: { type: McpServerType }): React.JSX.Element {
  const colors: Record<McpServerType, string> = {
    stdio: "bg-blue-500/15 text-blue-400",
    http: "bg-green-500/15 text-green-400",
    sse: "bg-purple-500/15 text-purple-400",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-label font-mono ${colors[type]}`}>
      {type}
    </span>
  );
}
