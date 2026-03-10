interface TriviaCardProps {
  topic: string;
  fact: string;
  isEasterEgg: boolean;
  factKey: number;
}

export default function TriviaCard({
  topic,
  fact,
  isEasterEgg,
  factKey,
}: TriviaCardProps) {
  return (
    <div
      key={factKey}
      className="animate-trivia-fade-in max-w-[560px] rounded-xl px-4 py-3 border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: isEasterEgg ? "var(--yellow)" : "var(--border-light)",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-label text-text-dim">
          {isEasterEgg ? "\u2B50 Fun fact!" : "\uD83D\uDCA1 Did you know?"}
        </span>
        <span
          className="text-label uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: "var(--bg-subtle)", color: "var(--text-faint)" }}
        >
          {topic}
        </span>
      </div>
      <p className="text-chat text-text-secondary leading-relaxed">{fact}</p>
    </div>
  );
}
