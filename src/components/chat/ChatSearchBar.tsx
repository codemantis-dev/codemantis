import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { useChatSearchStore } from "../../stores/chatSearchStore";
import { useSessionStore } from "../../stores/sessionStore";

interface ChatSearchBarProps {
  scrollRef: RefObject<HTMLDivElement | null>;
}

const ACTIVE_ATTR = "data-search-active";

export default function ChatSearchBar({ scrollRef }: ChatSearchBarProps) {
  const query = useChatSearchStore((s) => s.query);
  const currentIndex = useChatSearchStore((s) => s.currentIndex);
  const totalMatches = useChatSearchStore((s) => s.totalMatches);
  const setQuery = useChatSearchStore((s) => s.setQuery);
  const setTotalMatches = useChatSearchStore((s) => s.setTotalMatches);
  const next = useChatSearchStore((s) => s.next);
  const prev = useChatSearchStore((s) => s.prev);
  const close = useChatSearchStore((s) => s.close);

  // Re-sync match count whenever messages change underneath us
  const messageCount = useSessionStore((s) =>
    s.activeSessionId ? (s.sessionMessages.get(s.activeSessionId)?.length ?? 0) : 0
  );

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    if (!query) {
      if (totalMatches !== 0) setTotalMatches(0);
      return;
    }

    const hits = root.querySelectorAll<HTMLElement>("mark[data-search-match-index]");
    const count = hits.length;

    if (count !== totalMatches) {
      setTotalMatches(count);
    }

    // Strip stale active marker
    hits.forEach((el) => el.removeAttribute(ACTIVE_ATTR));

    if (count === 0) return;

    const activeIdx = Math.min(currentIndex, count - 1);
    const active = hits[activeIdx];
    if (active) {
      active.setAttribute(ACTIVE_ATTR, "true");
      active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  }, [query, currentIndex, totalMatches, messageCount, scrollRef, setTotalMatches]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    }
  };

  const counterText = !query
    ? ""
    : totalMatches === 0
    ? "No results"
    : `${currentIndex + 1} of ${totalMatches}`;

  return (
    <div
      className="absolute top-2 right-3 z-20 flex items-center gap-1 px-2 py-1 rounded-md border border-border shadow-md"
      style={{ background: "var(--bg-elevated)", backdropFilter: "blur(8px)" }}
      role="search"
      aria-label="Search in chat"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find in chat..."
        className="w-48 bg-transparent text-text-primary text-ui placeholder:text-text-ghost outline-none px-1"
        aria-label="Search query"
      />
      <span className="text-detail text-text-ghost min-w-[5.5rem] text-right tabular-nums">
        {counterText}
      </span>
      <button
        onClick={prev}
        disabled={totalMatches === 0}
        className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={next}
        disabled={totalMatches === 0}
        className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={close}
        className="p-1 rounded text-text-secondary hover:text-text-primary transition-colors"
        title="Close (Esc)"
        aria-label="Close search"
      >
        <X size={14} />
      </button>
    </div>
  );
}
