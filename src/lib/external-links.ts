import type { AnchorHTMLAttributes } from "react";
import { createElement } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * ReactMarkdown `a` component override that opens links in the default
 * browser via Tauri instead of navigating the webview.
 */
function ExternalLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown },
): React.ReactElement {
  const { href, children, node: _node, ...rest } = props;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (!href) return;
    openUrl(href).catch((err) =>
      console.error("Failed to open external URL:", err),
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
