import { useRef, useCallback, useState } from "react";

interface UseDividerResizeOptions {
  initialWidth: number;
  minPct?: number;
  maxPct?: number;
  onWidthChange: (newPct: number) => void;
}

interface UseDividerResizeReturn {
  dividerRef: React.RefObject<HTMLDivElement | null>;
  isDragging: boolean;
  handleDividerMouseDown: (e: React.MouseEvent) => void;
}

export function useDividerResize({
  initialWidth,
  minPct = 25,
  maxPct = 65,
  onWidthChange,
}: UseDividerResizeOptions): UseDividerResizeReturn {
  const dividerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const containerEl = dividerRef.current?.parentElement;
      if (!containerEl) return;
      const containerWidth = containerEl.getBoundingClientRect().width;
      const startPct = initialWidth;
      let rafId: number | null = null;

      const onMouseMove = (ev: MouseEvent) => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const dx = ev.clientX - startX;
          const dPct = (dx / containerWidth) * 100;
          const newPct = Math.max(minPct, Math.min(maxPct, startPct + dPct));
          onWidthChange(newPct);
        });
      };

      const onMouseUp = () => {
        setIsDragging(false);
        if (rafId !== null) cancelAnimationFrame(rafId);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [initialWidth, minPct, maxPct, onWidthChange]
  );

  return { dividerRef, isDragging, handleDividerMouseDown };
}
