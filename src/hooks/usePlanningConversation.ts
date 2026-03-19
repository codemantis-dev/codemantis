import { useCallback, useRef } from "react";
import { useTaskBoardStore } from "../stores/taskBoardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sendAssistantChat, listenAssistantStream, listTemplates } from "../lib/tauri-commands";
import { getProviderForModel } from "../types/assistant-provider";
import type { PlanningMessage, PlanningAttachment, TaskPlan, WorkPackage } from "../types/task-board";
import type { ContentPart } from "../lib/tauri-commands";

const BASE_PLANNING_PROMPT = `You are a senior product manager and technical architect. Before creating a task plan, you MUST have a thorough conversation with the user to understand their requirements completely.

CONVERSATION RULES:
- Start by acknowledging what the user described and identifying what's clear
- Ask ONE clarifying question at a time
- After your question, provide 2-5 selectable options using this EXACT format (one per line):
  ?> Option text here
  ?> Another option
- The user will select an option or provide a custom answer
- Continue asking one question at a time until you have enough info (typically 3-6 total)
- NEVER ask multiple questions in one response
- Ask about: target audience, design preferences, data sources, auth requirements, deployment target, specific UI components they envision, error handling expectations
- If the project requires backend services, databases, or containerized infrastructure, ask whether the user has Docker Desktop installed. Templates like fastapi-fullstack require Docker — mention this explicitly. For cloud-hosted databases (e.g., Supabase Cloud), Docker is not required.
- If the user attaches images (mockups, screenshots, Figma exports), analyze them and reference specific elements you see
- If the user attaches documents (PDFs, specs), read them and confirm your understanding
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
          "depends_on": [],
          "requires_user_action": null
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
- Use assertions: exists | visible | has_text | has_options | count_gte | not_exists

MANUAL/USER ACTION TASKS:
- If a task requires the user to do something outside the codebase (create an account, enter credentials, make a design decision, configure a third-party service), add "requires_user_action" with a clear instruction
- Examples: "Create a Supabase project at supabase.com and copy the project URL and anon key"
- These tasks pause execution until the user confirms completion
- Only use for actions that genuinely cannot be automated`;

function buildPlanningSystemPrompt(templateCatalog: string): string {
  return `${BASE_PLANNING_PROMPT}

AVAILABLE PROJECT TEMPLATES (use exact template ID for template_recommendation):
${templateCatalog}
- null: No template (ONLY for modifications to an existing project that already has its own setup)

IMPORTANT: New projects MUST use one of the templates listed above. CodeMantis can only reliably scaffold new projects using its built-in templates. If no template is an exact match, recommend the closest one and note what customization will be needed afterward. Do NOT recommend null/no template for new projects.

When recommending a template, use the exact template ID. Only recommend if creating a new project and a template clearly fits.`;
}

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
      requires_user_action?: string | null;
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
        const planningModel = settings.taskBoardPlanningModel || "gemini-2.5-flash";
        const provider = getProviderForModel(planningModel) ?? "gemini";
        const model = planningModel;
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
        store.initConversation(projectPath, provider, model, templateCatalog);
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
                      requires_user_action: t.requires_user_action ?? null,
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
                currentStore.setProjectTarget(projectPath, { type: 'undecided' });
                currentStore.setConversationStatus(projectPath, "monitoring");
                // Persist plan + conversation to database
                currentStore.persistState(projectPath);
              }
            } catch {
              // Not valid JSON — that's ok, it might be conversational
            }
          }

          streamBufferRef.current = "";
          // Persist conversation after each completed response
          currentStore.persistState(projectPath);
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
          systemPrompt: buildPlanningSystemPrompt(conv.templateCatalog ?? ''),
          messages: apiMessages,
          maxTokens: settings.taskBoardMaxTokens || 32768,
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
