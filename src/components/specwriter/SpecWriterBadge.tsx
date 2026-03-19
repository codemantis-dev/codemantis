import { useSpecWriterStore } from "../../stores/specWriterStore";

interface Props {
  projectPath: string;
}

export default function SpecWriterBadge({ projectPath }: Props) {
  const conversation = useSpecWriterStore((s) => s.conversations.get(projectPath));

  if (!conversation) return null;

  const statusLabel = (() => {
    switch (conversation.status) {
      case 'gathering': return 'Gathering...';
      case 'ready_to_write': return 'Spec ready';
      case 'writing': return 'Writing...';
      case 'done': return 'Done';
      default: return '';
    }
  })();

  if (!statusLabel) return null;

  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
        conversation.status === 'writing' ? "animate-pulse" : ""
      }`}
      style={{
        background: "var(--accent-bg)",
        color: "var(--accent)",
      }}
    >
      {statusLabel}
    </span>
  );
}
