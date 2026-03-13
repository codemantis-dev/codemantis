import { useEffect, useRef } from "react";

/**
 * Hook that detects clicks outside a ref element and calls onClose.
 * Optionally also closes on Escape key.
 *
 * Returns a ref to attach to the container element.
 */
export function useClickOutside<T extends HTMLElement>(
  isActive: boolean,
  onClose: () => void,
  options?: { closeOnEscape?: boolean },
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!isActive) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);

    let handleKeyDown: ((e: KeyboardEvent) => void) | undefined;
    if (options?.closeOnEscape) {
      handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      if (handleKeyDown) {
        document.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [isActive, onClose, options?.closeOnEscape]);

  return ref;
}
