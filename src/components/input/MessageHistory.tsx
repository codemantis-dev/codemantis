import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";

export interface MessageHistoryHandle {
  handleKeyDown: (key: string) => boolean;
}

interface MessageHistoryProps {
  items: string[];
  onSelect: (text: string) => void;
  onClose: () => void;
}

const MessageHistory = forwardRef<MessageHistoryHandle, MessageHistoryProps>(
  function MessageHistory({ items, onSelect, onClose }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(items.length - 1);
    const listRef = useClickOutside<HTMLDivElement>(true, onClose);
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

    // Scroll selected item into view
    useEffect(() => {
      const el = itemRefs.current.get(selectedIndex);
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    // Scroll to bottom on mount so the most recent (pre-selected) item is visible
    useEffect(() => {
      const container = listRef.current?.querySelector("[data-scroll-container]");
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, [listRef]);

    const selectCurrent = useCallback(() => {
      const text = items[selectedIndex];
      if (text !== undefined) {
        onSelect(text);
      }
    }, [items, selectedIndex, onSelect]);

    // Expose keyboard handler to parent
    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (key: string): boolean => {
          switch (key) {
            case "ArrowUp":
              setSelectedIndex((i) => Math.max(i - 1, 0));
              return true;
            case "ArrowDown":
              setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
              return true;
            case "Enter":
              selectCurrent();
              return true;
            case "Escape":
              onClose();
              return true;
            default:
              return false;
          }
        },
      }),
      [items.length, selectCurrent, onClose]
    );

    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border shadow-lg overflow-hidden z-10"
        style={{ background: "var(--bg-primary)", maxHeight: 300 }}
      >
        <div
          data-scroll-container
          className="overflow-y-auto"
          style={{ maxHeight: 300 }}
        >
          {items.map((text, i) => {
            const isSelected = i === selectedIndex;
            return (
              <button
                key={`${i}-${text.slice(0, 30)}`}
                ref={(el) => {
                  if (el) itemRefs.current.set(i, el);
                  else itemRefs.current.delete(i);
                }}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                  isSelected ? "bg-bg-subtle" : "hover:bg-bg-subtle/50"
                }`}
                onClick={() => onSelect(text)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="text-ui text-text-dim truncate">
                  {text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);

export default MessageHistory;
