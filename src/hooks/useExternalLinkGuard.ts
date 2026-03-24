import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Global safety-net that intercepts clicks on `<a>` elements with external
 * URLs and opens them in the default browser instead of navigating the webview.
 *
 * Call once in the app root (App.tsx).
 */
export function useExternalLinkGuard(): void {
  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      // Already handled (e.g. by ExternalLink component)
      if (e.defaultPrevented) return;

      const anchor = (e.target as HTMLElement).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = anchor.href;
      if (!href) return;

      // Only intercept http(s) and mailto links
      if (
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("mailto:")
      ) {
        return;
      }

      // Allow internal Tauri / dev-server URLs to navigate normally
      if (
        href.startsWith("http://localhost") ||
        href.startsWith("http://127.0.0.1") ||
        href.startsWith("tauri://") ||
        href.startsWith("asset://")
      ) {
        return;
      }

      // Escape hatch for intentional in-app navigation
      if (anchor.hasAttribute("data-internal-link")) return;

      e.preventDefault();
      openUrl(href).catch((err) =>
        console.error("Failed to open external URL:", err),
      );
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);
}
