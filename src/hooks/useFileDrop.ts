import { useEffect, useState, useRef, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ── Registry ─────────────────────────────────────────────────────

interface DropZoneEntry {
  ref: RefObject<HTMLElement | null>;
  priority: number;
  onDragStateChange: (over: boolean) => void;
  onDrop: (paths: string[]) => void;
}

const registry = new Map<string, DropZoneEntry>();
let globalUnlisten: UnlistenFn | null = null;
let setupPromise: Promise<void> | null = null;

// ── Hit-testing ──────────────────────────────────────────────────

function isInsideRect(
  pt: { x: number; y: number },
  rect: DOMRect
): boolean {
  return pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom;
}

/** Find the highest-priority visible handler (fallback when position misses). */
function findFallbackEntry(): DropZoneEntry | null {
  let best: DropZoneEntry | null = null;
  for (const entry of registry.values()) {
    const el = entry.ref.current;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) continue; // not visible
    if (!best || entry.priority > best.priority) best = entry;
  }
  return best;
}

// ── Global handler ───────────────────────────────────────────────

function handleEvent(event: { payload: DragDropEvent }): void {
  const payload = event.payload;

  if (payload.type === "enter" || payload.type === "over") {
    // On macOS, Tauri reports positions in AppKit points (logical/CSS pixels)
    // even though the JS wrapper labels them PhysicalPosition.
    // Use raw coordinates — they match getBoundingClientRect() directly.
    const pt = payload.position;
    let anyHit = false;
    for (const entry of registry.values()) {
      const el = entry.ref.current;
      if (!el) { entry.onDragStateChange(false); continue; }
      const hit = isInsideRect(pt, el.getBoundingClientRect());
      entry.onDragStateChange(hit);
      if (hit) anyHit = true;
    }
    // Fallback: if nothing matched, highlight the highest-priority visible zone
    if (!anyHit) {
      const fallback = findFallbackEntry();
      if (fallback) fallback.onDragStateChange(true);
    }
  } else if (payload.type === "drop") {
    const pt = payload.position;

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

    // Fallback: if position didn't match, use highest-priority visible handler
    if (!best) {
      best = findFallbackEntry();
      if (best) {
        console.warn("[useFileDrop] Position hit-test missed — using fallback handler");
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
    .catch((err) => { console.error("[useFileDrop] Failed to register listener:", err); setupPromise = null; });
}

function teardownGlobalListener(): void {
  if (globalUnlisten) { globalUnlisten(); globalUnlisten = null; }
}

// ── Hook ─────────────────────────────────────────────────────────

interface UseFileDropOptions {
  id: string;
  containerRef: RefObject<HTMLElement | null>;
  onDrop: (paths: string[]) => void;
  priority?: number;
  enabled?: boolean;
}

export function useFileDrop(options: UseFileDropOptions): { isDragOver: boolean } {
  const { id, containerRef, onDrop, priority = 1, enabled = true } = options;
  const [isDragOver, setIsDragOver] = useState(false);

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled) return;

    const entry: DropZoneEntry = {
      ref: containerRef,
      priority,
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
  }, [id, containerRef, priority, enabled]);

  return { isDragOver };
}
