import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, RefreshCw, Copy, Check } from "lucide-react";
import { showToast } from "../../stores/toastStore";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error("[AppErrorBoundary] Uncaught render error:", error);
    if (info.componentStack) {
      console.error("[AppErrorBoundary] Component stack:", info.componentStack);
    }
    showToast("The app hit an unexpected error. Recovery options are shown.", "error");
  }

  handleReset = (): void => {
    this.setState({ error: null, componentStack: null, copied: false });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleCopy = async (): Promise<void> => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const details = [
      `Message: ${error.message}`,
      "",
      `Stack:`,
      error.stack ?? "(no stack)",
      "",
      `Component stack:`,
      componentStack ?? "(no component stack)",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (e) {
      console.error("[AppErrorBoundary] Failed to copy details:", e);
    }
  };

  render(): ReactNode {
    const { error, componentStack, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="h-full w-full flex items-center justify-center p-8 overflow-auto"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="w-full max-w-xl rounded-lg border border-red/20 px-5 py-4"
          style={{
            background: "rgba(248,113,113,0.06)",
            borderLeftWidth: "3px",
            borderLeftColor: "var(--red)",
          }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-ui font-medium text-text-primary">Something went wrong</p>
              <p className="text-label text-text-secondary mt-1">
                The app caught an unexpected error and stopped rendering this view to keep
                the rest of the window responsive.
              </p>
              <pre className="mt-3 text-label font-mono text-text-secondary rounded border border-border-light p-2 overflow-x-auto max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all bg-bg-subtle">
                {error.message}
                {error.stack ? `\n\n${error.stack}` : ""}
                {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-ui border border-border-light hover:bg-bg-elevated transition-colors text-text-secondary"
                >
                  <RotateCcw size={13} />
                  Try to recover
                </button>
                <button
                  onClick={this.handleReload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-ui border border-border-light hover:bg-bg-elevated transition-colors text-text-secondary"
                >
                  <RefreshCw size={13} />
                  Reload window
                </button>
                <button
                  onClick={this.handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-ui border border-border-light hover:bg-bg-elevated transition-colors text-text-secondary"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy details"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
