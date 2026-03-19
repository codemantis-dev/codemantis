import { useCallback, useRef } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sendAssistantChat, listenAssistantStream, listTemplates, gatherSpecContext } from "../lib/tauri-commands";
import { getProviderForModel } from "../types/assistant-provider";
import type { SpecMessage, SpecAttachment } from "../types/spec-writer";
import type { ContentPart } from "../lib/tauri-commands";

const NEW_APP_PROMPT = `You are a senior technical architect and requirements analyst working inside CodeMantis, a desktop development tool. Your job is to have a thorough conversation with the user and then write a complete, implementation-ready requirements specification.

CONVERSATION PHASE:
- Start by acknowledging what the user described
- Ask ONE focused question at a time
- After each question, offer 2-5 selectable options:
  ?> Option A
  ?> Option B
  ?> Option C
- Dig deep: don't accept vague answers. "A dashboard" → what data? what visualizations? what user roles? what actions?
- If the user attaches images, reference specific visual elements
- If the user attaches documents, summarize what you found and confirm
- Ask about: user roles & permissions, data model, key pages/routes, UI components, error handling, loading/empty states, responsive design, authentication, deployment target, third-party integrations
- After 3-8 exchanges, summarize your understanding and say:
  "I have enough to write the specification. Ready when you are."
- Wait for confirmation before writing

WRITING PHASE:
When the user confirms, write a COMPLETE specification document in Markdown. The document MUST follow this structure:

# {Application Name} — Requirements Specification

## 1. Overview
Brief description, goals, target user.

## 2. Tech Stack & Architecture
Framework, libraries, database, deployment.
Reference the recommended CodeMantis template if applicable.

## 3. Data Model
Every entity with fields, types, relationships, and constraints.
Use code blocks for schema definitions.

## 4. Pages & Routes
Every page/route with: URL path, purpose, components on the page, user interactions, data fetched/displayed.

## 5. Components
Key reusable components with: props, behavior, states (loading, empty, error), and where they're used.

## 6. Authentication & Authorization
Auth method, user roles, route protection rules, session handling.

## 7. API / Data Layer
API endpoints or data fetching patterns. Include request/response shapes. For Supabase: RLS policies. For REST: endpoint list.

## 8. Error Handling & Edge Cases
What happens when: API fails, user has no data, invalid input, network offline, session expires. Every page should have error and empty states specified.

## 9. UI/UX Details
Layout behavior, responsive breakpoints, animations, loading indicators, toast notifications, form validation messages.

## 10. Implementation Notes
Order of implementation (what to build first), known complexities, suggested file structure.

WRITING RULES:
- Be SPECIFIC. Not "a data table" but "a data table with columns: Name (sortable), Status (filterable dropdown: active/inactive/all), Created (date, sortable), Actions (edit/delete buttons)"
- Include EVERY state: loading skeleton, empty state message, error state with retry button, success toast
- Include EVERY validation: email format, password min 8 chars, required fields, character limits
- Write for Claude Code to implement — use actual file paths, component names, and import patterns
- Reference the template's conventions if one is recommended

AFTER WRITING:
- After outputting the spec, ask: "Would you like me to adjust anything, or shall we save this?"
- If the user requests changes, output the COMPLETE revised spec (not just the changed section)

AVAILABLE TEMPLATES:
{TEMPLATE_CATALOG}`;

const FEATURE_MODE_PROMPT = `You are a senior technical architect working inside CodeMantis. You are helping the user write a requirements specification for a new feature in their EXISTING project.

PROJECT CONTEXT (gathered automatically):
{PROJECT_CONTEXT}

IMPORTANT: This is an existing codebase. Your specification MUST:
- Reference existing files by their actual paths
- Follow the patterns already established in the codebase
- Reuse existing components, hooks, and utilities where possible
- Extend (not replace) existing data models
- Match the existing code style and conventions
- Account for existing authentication, routing, and state management

CONVERSATION PHASE:
- Start by confirming what you see in the project: "I've reviewed your project. It's a {framework} app with {N} routes, using {key deps}. What would you like to add or change?"
- Ask ONE focused question at a time with selectable options:
  ?> Option A
  ?> Option B
  ?> Option C
- Ask questions that account for existing architecture
- When suggesting approaches, reference what's already built
- Ask about integration points: where in existing nav, which existing pages are affected, data model extensions needed
- After 3-8 exchanges, summarize your understanding and say:
  "I have enough to write the specification. Ready when you are."

WRITING PHASE:
Write a feature specification following this structure:

# {Feature Name} — Feature Specification

## 1. Overview
What this feature adds, why, and how it fits into the existing app.

## 2. Affected Files
List of existing files that need modification, with a summary of what changes in each. Plus new files to create.

## 3. Data Model Changes
New tables/models AND modifications to existing ones. Show complete model definitions including existing fields for context.

## 4. New Routes & Pages
New pages with: path, components, data requirements. Reference existing layout/navigation.

## 5. New & Modified Components
New components to create. Existing components to modify (specify what changes). Reuse existing components where possible.

## 6. API / Data Layer Changes
New endpoints or queries. Changes to existing ones. New RLS policies or middleware.

## 7. Integration Points
How this feature connects to existing features. Shared state, navigation changes, permission changes.

## 8. Error Handling & Edge Cases
Feature-specific error states. How errors surface in existing UI patterns.

## 9. Implementation Order
Step-by-step order: what to build first, what depends on what. Reference existing patterns.

WRITING RULES:
- Use ACTUAL file paths from the project
- Reference ACTUAL existing components and hooks by name
- Match the project's naming conventions exactly
- Follow the same patterns the project already uses
- Don't suggest dependencies that overlap with existing ones

AFTER WRITING:
- After outputting the spec, ask: "Would you like me to adjust anything, or shall we save this?"
- If the user requests changes, output the COMPLETE revised spec

AVAILABLE TEMPLATES:
{TEMPLATE_CATALOG}`;

function buildSystemPrompt(mode: 'new_application' | 'feature', templateCatalog: string, projectContext: string): string {
  if (mode === 'feature' && projectContext) {
    return FEATURE_MODE_PROMPT
      .replace('{PROJECT_CONTEXT}', projectContext)
      .replace('{TEMPLATE_CATALOG}', templateCatalog);
  }
  return NEW_APP_PROMPT.replace('{TEMPLATE_CATALOG}', templateCatalog);
}

const SPEC_READY_PATTERNS = [
  /i have enough to write the specification/i,
  /ready when you are/i,
  /shall i (?:write|generate|create) the (?:spec|specification)/i,
  /i have enough (?:information|details|context)/i,
  /ready to write/i,
];

const SPEC_START_PATTERN = /^#\s+.+(?:—|-)\s*(?:Requirements |Feature )?Specification/m;

export function useSpecConversation(): {
  sendMessage: (
    projectPath: string,
    content: string,
    attachments?: SpecAttachment[]
  ) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  loadContext: (projectPath: string) => Promise<void>;
} {
  const unlistenRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");
  const projectContextRef = useRef<Map<string, string>>(new Map());

  const loadContext = useCallback(async (projectPath: string) => {
    try {
      const context = await gatherSpecContext(projectPath);
      projectContextRef.current.set(projectPath, context);
      useSpecWriterStore.getState().setContextLoaded(projectPath, true);
    } catch (e) {
      console.warn("[useSpecConversation] Context gathering failed:", e);
      useSpecWriterStore.getState().setContextLoaded(projectPath, false);
    }
  }, []);

  const sendMessage = useCallback(
    async (
      projectPath: string,
      content: string,
      attachments?: SpecAttachment[]
    ) => {
      const store = useSpecWriterStore.getState();
      const settings = useSettingsStore.getState().settings;
      let conv = store.getActiveConversation(projectPath);

      // Initialize conversation if needed
      if (!conv) {
        const planningModel = settings.taskBoardPlanningModel || "gemini-2.5-flash";
        const provider = getProviderForModel(planningModel) ?? "gemini";
        const model = planningModel;

        // Determine mode: feature if there's an active project context
        const hasContext = projectContextRef.current.has(projectPath);
        const mode = hasContext ? 'feature' as const : 'new_application' as const;

        let templateCatalog = "";
        try {
          const templates = await listTemplates();
          templateCatalog = templates
            .map((t) => {
              let entry = `- ${t.id}: "${t.name}" [${t.category}]\n  ${t.description}`;
              if (t.long_description) entry += `\n  Details: ${t.long_description}`;
              if (t.tags.length > 0) entry += `\n  Tech: ${t.tags.join(', ')}`;
              entry += `\n  Install: ${t.install_command} | Dev: ${t.dev_command}`;
              if (t.prerequisites) entry += `\n  Requires: ${t.prerequisites}`;
              return entry;
            })
            .join("\n");
        } catch {
          // Continue without template catalog
        }
        store.initConversation(projectPath, provider, model, mode, templateCatalog);
        conv = store.getActiveConversation(projectPath)!;
      }

      const apiKey = settings.apiKeys[conv.ai_provider] ?? "";
      if (!apiKey) {
        store.addMessage(projectPath, {
          id: `msg-${Date.now()}`,
          role: "system",
          content: `No API key configured for ${conv.ai_provider}. Please add one in Settings → AI Providers.`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Add user message
      const userMessage: SpecMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        attachments,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addMessage(projectPath, userMessage);

      // Build API messages
      const updatedConv = useSpecWriterStore.getState().getActiveConversation(projectPath)!;
      const apiMessages: { role: string; content: string | ContentPart[] }[] =
        updatedConv.messages
          .filter((m) => m.role !== "system")
          .map((m) => {
            // If message has image attachments, build multimodal content
            if (m.attachments?.some((a) => a.type === "image" && a.preview_url)) {
              const parts: ContentPart[] = [{ type: "text", text: m.content }];
              for (const att of m.attachments) {
                if (att.type === "image" && att.preview_url) {
                  const base64 = att.preview_url.split(",")[1] ?? att.preview_url;
                  parts.push({
                    type: "image",
                    mime_type: att.mime_type,
                    data: base64,
                  });
                }
              }
              return { role: m.role, content: parts };
            }
            // If message has document attachments, append text content
            let text = m.content;
            if (m.attachments) {
              for (const att of m.attachments) {
                if (att.type === "document" && att.text_content) {
                  text += `\n\n--- Attached document: ${att.name} ---\n${att.text_content}`;
                }
              }
            }
            return { role: m.role, content: text };
          });

      // Add assistant placeholder for streaming
      const assistantMsg: SpecMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addMessage(projectPath, assistantMsg);
      store.setPlanningStreaming(projectPath, true);

      // Setup stream listener
      const assistantId = `spec-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      streamBufferRef.current = "";

      if (unlistenRef.current) {
        unlistenRef.current();
      }

      unlistenRef.current = await listenAssistantStream(assistantId, (event) => {
        const currentStore = useSpecWriterStore.getState();

        if (event.type === "delta" && event.text) {
          streamBufferRef.current += event.text;
          currentStore.updateLastAssistantMessage(projectPath, streamBufferRef.current);

          // Check for spec content during streaming
          if (SPEC_START_PATTERN.test(streamBufferRef.current)) {
            currentStore.setCurrentSpecContent(projectPath, streamBufferRef.current);
          }
        }

        if (event.type === "done") {
          currentStore.setPlanningStreaming(projectPath, false);
          const finalContent = streamBufferRef.current;

          // Parse selectable options from ?> markers
          const optionPattern = /^\?>\s*(.+)$/gm;
          const options: string[] = [];
          let m;
          while ((m = optionPattern.exec(finalContent)) !== null) {
            options.push(m[1].trim());
          }
          if (options.length > 0) {
            const cleanContent = finalContent.replace(/^\?>\s*.+$/gm, '').trim();
            currentStore.updateLastAssistantMessage(projectPath, cleanContent);
            currentStore.setMessageOptions(projectPath, options);
          }

          // Check if AI is ready to write spec
          if (SPEC_READY_PATTERNS.some((p) => p.test(finalContent))) {
            currentStore.setConversationStatus(projectPath, "ready_to_write");
          }

          // Check for spec document output
          if (SPEC_START_PATTERN.test(finalContent)) {
            currentStore.setCurrentSpecContent(projectPath, finalContent);
            currentStore.setConversationStatus(projectPath, "done");
            // Update the message type to spec_document
            const conv = currentStore.getActiveConversation(projectPath);
            if (conv && conv.messages.length > 0) {
              const messages = [...conv.messages];
              const lastIdx = messages.length - 1;
              if (messages[lastIdx].role === 'assistant') {
                messages[lastIdx] = { ...messages[lastIdx], message_type: 'spec_document' };
              }
              // Directly update via set
              useSpecWriterStore.setState((state) => {
                const conversations = new Map(state.conversations);
                const c = conversations.get(projectPath);
                if (c) {
                  conversations.set(projectPath, { ...c, messages });
                }
                return { conversations };
              });
            }
          }

          streamBufferRef.current = "";
          currentStore.persistState(projectPath);
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }

        if (event.type === "error") {
          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.addMessage(projectPath, {
            id: `msg-err-${Date.now()}`,
            role: "system",
            content: `Error: ${event.message ?? "Unknown error"}`,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }
      });

      // Build system prompt
      const projectContext = projectContextRef.current.get(projectPath) ?? "";
      const systemPrompt = buildSystemPrompt(
        conv.mode,
        conv.templateCatalog ?? '',
        projectContext
      );

      // Send the API call
      try {
        await sendAssistantChat({
          assistantId,
          provider: conv.ai_provider,
          apiKey,
          model: conv.ai_model,
          systemPrompt,
          messages: apiMessages,
          maxTokens: settings.taskBoardMaxTokens || 32768,
        });
      } catch (err) {
        store.setPlanningStreaming(projectPath, false);
        store.addMessage(projectPath, {
          id: `msg-err-${Date.now()}`,
          role: "system",
          content: `Failed to send message: ${err}`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
      }
    },
    []
  );

  const writeSpec = useCallback(
    (projectPath: string) => {
      const store = useSpecWriterStore.getState();
      store.setConversationStatus(projectPath, "writing");
      sendMessage(projectPath, "Yes, write the specification now.");
    },
    [sendMessage]
  );

  return {
    sendMessage,
    writeSpec,
    loadContext,
  };
}
