import { useState, useCallback, type HTMLAttributes } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps extends HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  className?: string;
}

export default function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const isInline = !className;
  const language = className?.replace("language-", "") ?? "";

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, "");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  if (isInline) {
    return (
      <code className={className} {...props}>
        {children}
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
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-secondary transition-colors opacity-0 group-hover:opacity-100 ml-auto"
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
        {children}
      </code>
    </div>
  );
}
