import type { AnchorHTMLAttributes } from "react";
import { createElement } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openFileInViewer } from "../hooks/useFileViewer";

/** Web schemes that should open in the system browser, not the File Viewer. */
const WEB_SCHEME = /^(https?|mailto|tel|ftp):/i;

/**
 * ReactMarkdown `a` component override. Web URLs open in the default browser
 * via Tauri; local file paths (relative or absolute) open in the right-panel
 * File Viewer instead.
 */
function ExternalLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown },
): React.ReactElement {
  const { href, children, node: _node, ...rest } = props;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (!href || href.startsWith("#")) return;
    if (WEB_SCHEME.test(href)) {
      openUrl(href).catch((err) =>
        console.error("Failed to open external URL:", err),
      );
      return;
    }
    openFileInViewer(href).catch((err) =>
      console.error("Failed to open file:", err),
    );
  };

  return createElement(
    "a",
    {
      ...rest,
      href,
      rel: "noopener noreferrer",
      onClick: handleClick,
      style: { cursor: "pointer" },
    },
    children,
  );
}

/** Ready-made components prop for ReactMarkdown. */
export const markdownLinkComponents: { a: typeof ExternalLink } = {
  a: ExternalLink,
};

export { ExternalLink };
