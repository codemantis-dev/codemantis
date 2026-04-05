import { useSpecWriterStore } from "../../stores/specWriterStore";

interface Props {
  projectPath: string;
}

export default function SpecWriterBadge({ projectPath }: Props) {
  const conversation = useSpecWriterStore((s) => s.conversations.get(projectPath));
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);

  if (!conversation) return null;

  const hasMessages = conversation.messages.length > 0;

  const statusLabel = (() => {
    switch (conversation.status) {
      case 'gathering': return hasMessages ? 'In progress' : '';
      case 'ready_to_write': return 'Spec ready';
      case 'writing': return 'Writing...';
      case 'done': return isStreaming ? 'Working...' : 'Done';
      default: return '';
    }
  })();

  if (!statusLabel) return null;

  const showPulse = conversation.status === 'writing' || (conversation.status === 'done' && isStreaming);

  return (
    <span
      className={`text-detail px-1.5 py-0.5 rounded-full ${
        showPulse ? "animate-pulse" : ""
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
