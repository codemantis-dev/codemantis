import { Copy, ArrowUpRight, Bookmark } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useClickOutside } from "../../hooks/useClickOutside";

interface AssistantMessageMenuProps {
  x: number;
  y: number;
  messageText: string;
  onClose: () => void;
  onAddShortcut: (prompt: string) => void;
}

export default function AssistantMessageMenu({
  x,
  y,
  messageText,
  onClose,
  onAddShortcut,
}: AssistantMessageMenuProps) {
  const menuRef = useClickOutside<HTMLDivElement>(true, onClose, { closeOnEscape: true });

  // Clamp position to prevent viewport overflow
  const menuWidth = 180;
  const menuHeight = 120;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const items = [
    {
      label: "Copy",
      icon: Copy,
      action: () => {
        navigator.clipboard.writeText(messageText);
        onClose();
      },
    },
    {
      label: "Use in Chat",
      icon: ArrowUpRight,
      action: () => {
        useUiStore.getState().setDraftInput(messageText);
        onClose();
      },
    },
    {
      label: "Add as Shortcut",
      icon: Bookmark,
      action: () => {
        onAddShortcut(messageText);
        onClose();
      },
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 border border-border rounded-lg shadow-lg py-1"
      style={{ background: "var(--bg-primary)", left: clampedX, top: clampedY, minWidth: menuWidth }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            onClick={item.action}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-ui text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors text-left"
          >
            <Icon size={14} className="text-text-faint shrink-0" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
