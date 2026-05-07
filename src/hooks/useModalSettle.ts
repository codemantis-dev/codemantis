import { useCallback, useEffect, useRef } from "react";

// Ignore stray Enter / Escape / pointer-down-outside for this many ms after a
// modal opens. Prevents a keystroke that was already in flight when the modal
// appeared (e.g. user holding Enter in chat) from immediately confirming or
// cancelling the dialog.
export const MODAL_SETTLE_MS = 400;

/**
 * Returns `isSettling()` — true for ~MODAL_SETTLE_MS after `open` flips true.
 * Modal keydown handlers should bail early when this is true.
 */
export function useModalSettle(open: boolean): () => boolean {
  const openedAtRef = useRef<number>(0);
  useEffect(() => {
    if (open) openedAtRef.current = performance.now();
  }, [open]);
  return useCallback(
    () => performance.now() - openedAtRef.current < MODAL_SETTLE_MS,
    [],
  );
}
