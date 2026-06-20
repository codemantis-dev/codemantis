/**
 * DuoAgentSplit — the primary | mentor split of two live agent chats, with a
 * draggable divider. Reads the pinned session ids from the duo store.
 */
import { useState } from "react";
import { useDuoStore } from "../../stores/duoStore";
import { useDividerResize } from "../../hooks/useDividerResize";
import DuoAgentPane from "./DuoAgentPane";

export default function DuoAgentSplit(): React.ReactElement {
  const primaryId = useDuoStore((s) => s.primarySessionId);
  const duoId = useDuoStore((s) => s.duoSessionId);
  const [leftPct, setLeftPct] = useState(50);
  const { dividerRef, isDragging, handleDividerMouseDown } = useDividerResize({
    initialWidth: 50,
    minPct: 25,
    maxPct: 75,
    onWidthChange: setLeftPct,
  });

  if (!primaryId || !duoId) {
    return (
      <div className="h-full flex items-center justify-center text-detail" style={{ color: "var(--text-dim)" }}>
        No active Duo run.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="h-full min-w-0" style={{ width: `${leftPct}%` }}>
        <DuoAgentPane sessionId={primaryId} role="primary" />
      </div>
      <div
        ref={dividerRef}
        onMouseDown={handleDividerMouseDown}
        className="w-1.5 shrink-0 cursor-col-resize"
        style={{ background: isDragging ? "var(--accent)" : "var(--border)" }}
      />
      <div className="h-full flex-1 min-w-0">
        <DuoAgentPane sessionId={duoId} role="mentor" />
      </div>
    </div>
  );
}
