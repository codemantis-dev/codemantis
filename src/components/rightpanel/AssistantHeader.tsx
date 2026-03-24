import { Info } from "lucide-react";
import type { AssistantInstance, TokenUsage } from "../../stores/assistantStore";
import type { AIProvider } from "../../types/assistant-provider";
import AssistantTabs from "./AssistantTabs";
import AssistantProviderMenu from "./AssistantProviderMenu";
import type { Message } from "../../types/session";

interface StreamingInfo {
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;
}

interface AssistantHeaderProps {
  assistants: AssistantInstance[];
  activeAssistantId: string | null;
  allBusy: Map<string, boolean>;
  allCost: Map<string, TokenUsage>;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => Promise<void>;
  onOpenProviderMenu: () => void;
  showProviderMenu: boolean;
  providerMenuRef: React.RefObject<HTMLDivElement | null>;
  apiKeys: Record<string, string>;
  expandedProvider: string | null;
  creating: boolean;
  onExpandProvider: (v: string | null) => void;
  onCreate: (provider?: AIProvider, model?: string) => Promise<void>;
  isApiProvider: boolean | undefined;
  activeInstance: AssistantInstance | undefined;
  messages: Message[];
  streaming: StreamingInfo | undefined;
}

export default function AssistantHeader({
  assistants,
  activeAssistantId,
  allBusy,
  allCost,
  onSelect,
  onClose,
  onOpenProviderMenu,
  showProviderMenu,
  providerMenuRef,
  apiKeys,
  expandedProvider,
  creating,
  onExpandProvider,
  onCreate,
  isApiProvider,
  activeInstance,
  messages,
  streaming,
}: AssistantHeaderProps) {
  return (
    <>
      <AssistantTabs
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        busyMap={allBusy}
        costMap={allCost}
        onSelect={onSelect}
        onClose={onClose}
        onCreate={onOpenProviderMenu}
      />

      {showProviderMenu && (
        <AssistantProviderMenu
          variant="popover"
          menuRef={providerMenuRef}
          apiKeys={apiKeys}
          expandedProvider={expandedProvider}
          creating={creating}
          onExpandProvider={onExpandProvider}
          onCreate={onCreate}
        />
      )}

      {isApiProvider && messages.length === 0 && !streaming?.isStreaming && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-text-ghost border-b border-border-light" style={{ background: "var(--bg-secondary)" }}>
          <Info size={10} />
          <span>Chat only — no file access or tool use. Uses your {activeInstance!.provider} API key.</span>
        </div>
      )}
    </>
  );
}
