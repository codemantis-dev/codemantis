import { useCallback, useRef } from "react";
import { useTaskBoardStore } from "../stores/taskBoardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sendAssistantChat, listenAssistantStream } from "../lib/tauri-commands";
import type { PlanningMessage, PlanningAttachment, TaskPlan, WorkPackage } from "../types/task-board";
import type { ContentPart } from "../lib/tauri-commands";

const PLANNING_SYSTEM_PROMPT = `You are a senior product manager and technical architect. Before creating a task plan, you MUST have a thorough conversation with the user to understand their requirements completely.

CONVERSATION RULES:
- Start by acknowledging what the user described and identifying what's clear
- Ask 3-5 focused clarifying questions about ambiguities, decisions, and preferences
- Ask about: target audience, design preferences, data sources, auth requirements, deployment target, specific UI components they envision, error handling expectations
- If the user attaches images (mockups, screenshots, Figma exports), analyze them and reference specific elements you see
- If the user attaches documents (PDFs, specs), read them and confirm your understanding
- Continue the conversation until you have enough information — typically 2-4 exchanges
- When ready, say: "I have enough information to create the plan. Shall I proceed?"
- Only after the user confirms, generate the structured JSON task plan

DO NOT generate the task plan in your first response. Always start with questions.

When generating the plan, respond in JSON format ONLY (no markdown, no preamble):
{
  "plan_name": "string",
  "template_recommendation": "string or null",
  "work_packages": [
    {
      "id": "WP1",
      "name": "string",
      "tasks": [
        {
          "id": "T1",
          "title": "string",
          "description": "string (2-3 sentences)",
          "acceptance_criteria": "string",
          "verification_checks": [
            { "type": "file_exists", "path": "string", "description": "string" },
            { "type": "file_contains", "path": "string", "pattern": "string", "description": "string" },
            { "type": "grep_codebase", "pattern": "string", "description": "string" },
            { "type": "command_succeeds", "command": "string", "description": "string" },
            { "type": "dom_check", "route": "string", "selector": "string", "assertion": "exists|visible|has_text|has_options|count_gte|not_exists", "expected": "string or number (optional)", "description": "string" }
          ],
          "work_package": "WP1",
          "depends_on": []
        }
      ]
    }
  ]
}

RULES for task decomposition:
- Each task must be small enough to verify with a single check
- Include ALL details — error states, loading states, empty states, validation rules, edge cases
- Do NOT combine multiple distinct features into one task
- Order tasks by dependency (foundational tasks first)
- Group related tasks into work packages of 5-8 tasks each
- For DOM checks: provide multiple fallback selectors separated by commas
- Use assertions: exists | visible | has_text | has_options | count_gte | not_exists`;

const PLAN_READY_PATTERNS = [
  /shall i (?:proceed|generate|create)/i,
  /ready to (?:create|generate|build) the plan/i,
  /i have enough (?:information|details|context)/i,
  /let me (?:create|generate|build) the plan/i,
];

interface ParsedPlanJson {
  plan_name?: string;
  template_recommendation?: string | null;
  work_packages: {
    id: string;
    name: string;
    tasks?: {
      id: string;
      title: string;
      description?: string;
      acceptance_criteria?: string;
      verification_checks?: {
        type: string;
        path?: string;
        pattern?: string;
        command?: string;
        route?: string;
        selector?: string;
        assertion?: string;
        expected?: string | number;
        description?: string;
      }[];
      work_package?: string;
      depends_on?: string[];
    }[];
  }[];
}

export function usePlanningConversation(): {
  sendPlanningMessage: (
    projectPath: string,
    content: string,
    attachments?: PlanningAttachment[]
  ) => Promise<void>;
  generatePlan: (projectPath: string) => void;
} {
  const unlistenRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");

  const sendPlanningMessage = useCallback(
    async (
      projectPath: string,
      content: string,
      attachments?: PlanningAttachment[]
    ) => {
      const store = useTaskBoardStore.getState();
      const settings = useSettingsStore.getState().settings;
      let conv = store.getActiveConversation(projectPath);

      // Initialize conversation if needed
      if (!conv) {
        const provider = settings.assistantDefaultProvider === "claude-code"
          ? "gemini"
          : settings.assistantDefaultProvider;
        const model = settings.assistantDefaultModel[provider] ?? "gemini-2.5-flash";
        store.initConversation(projectPath, provider, model);
        conv = store.getActiveConversation(projectPath)!;
      }

      const apiKey = settings.apiKeys[conv.ai_provider] ?? "";
      if (!apiKey) {
        store.addPlanningMessage(projectPath, {
          id: `msg-${Date.now()}`,
          role: "system",
          content: `No API key configured for ${conv.ai_provider}. Please add one in Settings → AI Providers.`,
          message_type: "conversation",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Add user message
      const userMessage: PlanningMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        attachments,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addPlanningMessage(projectPath, userMessage);

      // Build API messages
      const updatedConv = useTaskBoardStore.getState().getActiveConversation(projectPath)!;
      const apiMessages: { role: string; content: string | ContentPart[] }[] =
        updatedConv.messages
          .filter((m) => m.role !== "system")
          .map((m) => {
            // If message has image attachments, build multimodal content
            if (m.attachments?.some((a) => a.type === "image" && a.preview_url)) {
              const parts: ContentPart[] = [{ type: "text", text: m.content }];
              for (const att of m.attachments) {
                if (att.type === "image" && att.preview_url) {
                  // preview_url is base64 data URI
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
      const assistantMsg: PlanningMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      };
      store.addPlanningMessage(projectPath, assistantMsg);
      store.setPlanningStreaming(projectPath, true);

      // Setup stream listener
      const assistantId = `planning-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      streamBufferRef.current = "";

      if (unlistenRef.current) {
        unlistenRef.current();
      }

      unlistenRef.current = await listenAssistantStream(assistantId, (event) => {
        const currentStore = useTaskBoardStore.getState();

        if (event.type === "delta" && event.text) {
          streamBufferRef.current += event.text;
          currentStore.updateLastAssistantMessage(projectPath, streamBufferRef.current);
        }

        if (event.type === "done") {
          currentStore.setPlanningStreaming(projectPath, false);
          const finalContent = streamBufferRef.current;

          // Check if AI is ready to generate plan
          if (PLAN_READY_PATTERNS.some((p) => p.test(finalContent))) {
            currentStore.setConversationStatus(projectPath, "ready_to_plan");
          }

          // Try to parse as JSON task plan
          const jsonMatch = finalContent.match(/\{[\s\S]*"work_packages"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              let jsonStr = jsonMatch[0];
              // Strip markdown code blocks if present
              jsonStr = jsonStr.replace(/^```json?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
              const parsed: ParsedPlanJson = JSON.parse(jsonStr);
              if (parsed.work_packages && Array.isArray(parsed.work_packages)) {
                const plan: TaskPlan = {
                  id: `plan-${Date.now()}`,
                  name: parsed.plan_name ?? "Task Plan",
                  description: "",
                  template_recommendation: parsed.template_recommendation ?? null,
                  work_packages: parsed.work_packages.map((wp): WorkPackage => ({
                    id: wp.id,
                    name: wp.name,
                    tasks: (wp.tasks ?? []).map((t) => ({
                      id: t.id,
                      title: t.title,
                      description: t.description ?? "",
                      acceptance_criteria: t.acceptance_criteria ?? "",
                      verification_checks: (t.verification_checks ?? []).map((c) => ({
                        type: c.type as "file_exists" | "file_contains" | "grep_codebase" | "command_succeeds" | "dom_check",
                        path: c.path,
                        pattern: c.pattern,
                        command: c.command,
                        route: c.route,
                        selector: c.selector,
                        assertion: c.assertion as "exists" | "visible" | "has_text" | "has_options" | "count_gte" | "not_exists" | undefined,
                        expected: c.expected,
                        description: c.description ?? "",
                      })),
                      work_package: wp.id,
                      depends_on: t.depends_on ?? [],
                      status: "planned" as const,
                    })),
                    status: "planned" as const,
                    session_id: null,
                    retry_count: 0,
                  })),
                  created_at: new Date().toISOString(),
                  status: "ready",
                  project_path: projectPath,
                };
                currentStore.createPlan(projectPath, plan);
                currentStore.setConversationStatus(projectPath, "monitoring");
              }
            } catch {
              // Not valid JSON — that's ok, it might be conversational
            }
          }

          streamBufferRef.current = "";
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
        }

        if (event.type === "error") {
          currentStore.setPlanningStreaming(projectPath, false);
          currentStore.addPlanningMessage(projectPath, {
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

      // Send the API call
      try {
        await sendAssistantChat({
          assistantId,
          provider: conv.ai_provider,
          apiKey,
          model: conv.ai_model,
          systemPrompt: PLANNING_SYSTEM_PROMPT,
          messages: apiMessages,
        });
      } catch (err) {
        store.setPlanningStreaming(projectPath, false);
        store.addPlanningMessage(projectPath, {
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

  const generatePlan = useCallback(
    (projectPath: string) => {
      sendPlanningMessage(projectPath, "Yes, generate the plan now.");
    },
    [sendPlanningMessage]
  );

  return {
    sendPlanningMessage,
    generatePlan,
  };
}
