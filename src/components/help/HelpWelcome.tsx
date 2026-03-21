interface HelpWelcomeProps {
  onSuggestionClick: (text: string) => void;
}

const SUGGESTIONS = [
  "How do I create a new project from a template?",
  "What are the three session modes?",
  "How do I connect an MCP server?",
  "How do I use SpecWriter?",
  "What keyboard shortcuts are available?",
];

export default function HelpWelcome({ onSuggestionClick }: HelpWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-lg mb-1" style={{ color: "var(--text-primary)" }}>
        Welcome! I'm your CodeMantis helper.
      </p>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        I know every feature, shortcut, and setting in the app. Ask me anything:
      </p>
      <div className="flex flex-col gap-2 w-full max-w-[320px]">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onSuggestionClick(text)}
            className="text-left text-sm px-3 py-2 rounded-lg border transition-colors hover:brightness-95"
            style={{
              color: "var(--text-secondary)",
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
            }}
          >
            "{text}"
          </button>
        ))}
      </div>
    </div>
  );
}
