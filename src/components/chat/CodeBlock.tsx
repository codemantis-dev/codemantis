import {
  useState,
  useCallback,
  cloneElement,
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { useChatSearchStore } from "../../stores/chatSearchStore";
import { highlightText } from "../../lib/highlight-text";

interface CodeBlockProps extends HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  className?: string;
  node?: { position?: { start: { line: number }; end: { line: number } } };
}

export default function CodeBlock({ children, className, node, ...props }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const searchQuery = useChatSearchStore((s) => s.query);

  // Block code: has a language class OR spans multiple lines in the markdown source
  const isBlock = !!className || (node?.position != null && node.position.end.line > node.position.start.line);
  const language = className?.replace("language-", "") ?? "";

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, "");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  // Highlight inside code by walking the children tree but bypassing the
  // code/pre skip rule (the rule exists for the markdown walker — here we
  // explicitly want to highlight inside <code>).
  const renderedChildren: ReactNode = searchQuery
    ? highlightCodeChildren(children, searchQuery)
    : children;

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {renderedChildren}
      </code>
    );
  }

  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-light">
        {language && (
          <span className="text-label text-text-ghost">{language}</span>
        )}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-secondary transition-colors ml-auto"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={11} className="text-green" />
              <span className="text-green">Copied</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <code className={className} {...props}>
        {renderedChildren}
      </code>
    </div>
  );
}

function highlightCodeChildren(children: ReactNode, query: string): ReactNode {
  // Local walker — unlike highlightChildren this does NOT skip code/pre,
  // because here we're already inside a code block and the user expects
  // matches there to highlight.
  const counter = { i: 0 };
  const walk = (node: ReactNode): ReactNode => {
    if (typeof node === "string") {
      const { nodes, nextIndex } = highlightText(node, query, counter.i);
      counter.i = nextIndex;
      return nodes;
    }
    if (Array.isArray(node)) {
      return node.map((c, idx) => {
        const out = walk(c);
        if (isValidElement(out) && out.key == null) {
          return cloneElement(out, { key: `cc-${idx}` });
        }
        return out;
      });
    }
    if (isValidElement(node)) {
      const props = node.props as { children?: ReactNode };
      if (props.children == null) return node;
      return cloneElement(node, undefined, walk(props.children));
    }
    return node;
  };
  return walk(children);
}
