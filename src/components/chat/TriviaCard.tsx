import { useSettingsStore } from "../../stores/settingsStore";

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
  const updateSettings = useSettingsStore((s) => s.updateSettings);

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
          className="text-label uppercase tracking-wide px-1.5 py-0.5 rounded font-medium"
          style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)" }}
        >
          {topic}
        </span>
      </div>
      <p className="text-chat text-text-secondary leading-relaxed">{fact}</p>
      <div className="flex justify-end mt-1.5">
        <button
          onClick={() => updateSettings({ triviaEnabled: false })}
          className="text-label text-text-ghost hover:text-text-dim transition-colors"
        >
          Disable trivia
        </button>
      </div>
    </div>
  );
}
