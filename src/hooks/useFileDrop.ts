import { useEffect, useState, useRef, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ── Registry ─────────────────────────────────────────────────────

interface DropZoneEntry {
  ref: RefObject<HTMLElement | null>;
  onDragStateChange: (over: boolean) => void;
  onDrop: (paths: string[]) => void;
}

const registry = new Map<string, DropZoneEntry>();
let globalUnlisten: UnlistenFn | null = null;
let setupPromise: Promise<void> | null = null;

// ── Hit-testing ──────────────────────────────────────────────────

function toLogical(physical: { x: number; y: number }): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  return { x: physical.x / dpr, y: physical.y / dpr };
}

function isInsideRect(
  pt: { x: number; y: number },
  rect: DOMRect
): boolean {
  return pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom;
}

// ── Global handler ───────────────────────────────────────────────

function handleEvent(event: { payload: DragDropEvent }): void {
  const payload = event.payload;

  if (payload.type === "enter" || payload.type === "over") {
    const pt = toLogical(payload.position);
    for (const entry of registry.values()) {
      const el = entry.ref.current;
      if (!el) { entry.onDragStateChange(false); continue; }
      entry.onDragStateChange(isInsideRect(pt, el.getBoundingClientRect()));
    }
  } else if (payload.type === "drop") {
    const pt = toLogical(payload.position);

    // Find the smallest matching zone (most specific target)
    let best: DropZoneEntry | null = null;
    let bestArea = Infinity;
    for (const entry of registry.values()) {
      const el = entry.ref.current;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (isInsideRect(pt, rect)) {
        const area = rect.width * rect.height;
        if (area < bestArea) { bestArea = area; best = entry; }
      }
    }

    // Clear all drag states
    for (const entry of registry.values()) entry.onDragStateChange(false);

    if (best && payload.paths.length > 0) best.onDrop(payload.paths);
  } else {
    // leave
    for (const entry of registry.values()) entry.onDragStateChange(false);
  }
}

// ── Lifecycle ────────────────────────────────────────────────────

function ensureGlobalListener(): void {
  if (globalUnlisten || setupPromise) return;
  setupPromise = getCurrentWebview()
    .onDragDropEvent(handleEvent)
    .then((unlisten) => { globalUnlisten = unlisten; setupPromise = null; })
    .catch(() => { setupPromise = null; });
}

function teardownGlobalListener(): void {
  if (globalUnlisten) { globalUnlisten(); globalUnlisten = null; }
}

// ── Hook ─────────────────────────────────────────────────────────

interface UseFileDropOptions {
  id: string;
  containerRef: RefObject<HTMLElement | null>;
  onDrop: (paths: string[]) => void;
  enabled?: boolean;
}

export function useFileDrop(options: UseFileDropOptions): { isDragOver: boolean } {
  const { id, containerRef, onDrop, enabled = true } = options;
  const [isDragOver, setIsDragOver] = useState(false);

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled) return;

    const entry: DropZoneEntry = {
      ref: containerRef,
      onDragStateChange: setIsDragOver,
      onDrop: (paths) => onDropRef.current(paths),
    };

    registry.set(id, entry);
    ensureGlobalListener();

    return () => {
      registry.delete(id);
      setIsDragOver(false);
      if (registry.size === 0) teardownGlobalListener();
    };
  }, [id, containerRef, enabled]);

  return { isDragOver };
}
