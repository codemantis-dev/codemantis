import { useEffect, useState } from "react";

export default function ThinkingIndicator() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-start mb-4">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl rounded-bl-md"
        style={{ background: "var(--bg-elevated)" }}
      >
        {/* Animated orbs */}
        <div className="flex items-center gap-1">
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
        </div>

        <span className="text-chat text-text-dim">
          Claude is working{".".repeat(dots)}
        </span>
      </div>
    </div>
  );
}
