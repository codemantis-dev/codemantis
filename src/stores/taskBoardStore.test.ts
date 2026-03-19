import { describe, it, expect, beforeEach } from "vitest";
import { useTaskBoardStore } from "./taskBoardStore";
import type { TaskPlan, WorkPackage } from "../types/task-board";

const PROJECT = "/tmp/test-project";
const PROJECT_B = "/tmp/test-project-b";

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    id: "plan-1",
    name: "Test Plan",
    description: "",
    template_recommendation: null,
    work_packages: [
      {
        id: "WP1",
        name: "Setup",
        tasks: [
          {
            id: "T1",
            title: "Create file",
            description: "",
            acceptance_criteria: "",
            verification_checks: [],
            work_package: "WP1",
            depends_on: [],
            status: "planned",
          },
        ],
        status: "planned",
        session_id: null,
        retry_count: 0,
      },
      {
        id: "WP2",
        name: "Build",
        tasks: [],
        status: "planned",
        session_id: null,
        retry_count: 0,
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    status: "ready",
    project_path: PROJECT,
    ...overrides,
  };
}

function resetStore(): void {
  useTaskBoardStore.setState({
    plans: new Map(),
    conversations: new Map(),
    uiState: new Map(),
    executingProject: null,
    executingWorkPackage: null,
    isPaused: false,
    planningStreaming: new Map(),
    projectTargetDecisions: new Map(),
  });
}

describe("taskBoardStore", () => {
  beforeEach(resetStore);

  // ── Plan management ──

  it("starts empty", () => {
    const s = useTaskBoardStore.getState();
    expect(s.plans.size).toBe(0);
    expect(s.conversations.size).toBe(0);
  });

  it("createPlan stores a plan keyed by projectPath", () => {
    const plan = makePlan();
    useTaskBoardStore.getState().createPlan(PROJECT, plan);
    expect(useTaskBoardStore.getState().plans.get(PROJECT)).toEqual(plan);
  });

  it("updatePlanStatus changes plan status", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().updatePlanStatus(PROJECT, "executing");
    expect(useTaskBoardStore.getState().plans.get(PROJECT)!.status).toBe("executing");
  });

  it("removePlan deletes the plan", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().removePlan(PROJECT);
    expect(useTaskBoardStore.getState().plans.has(PROJECT)).toBe(false);
  });

  // ── Work package management ──

  it("updateWorkPackageStatus changes WP status", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().updateWorkPackageStatus(PROJECT, "WP1", "in_progress");
    const wp = useTaskBoardStore.getState().plans.get(PROJECT)!.work_packages[0];
    expect(wp.status).toBe("in_progress");
  });

  it("incrementRetryCount increases retry_count by 1", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().incrementRetryCount(PROJECT, "WP1");
    useTaskBoardStore.getState().incrementRetryCount(PROJECT, "WP1");
    const wp = useTaskBoardStore.getState().plans.get(PROJECT)!.work_packages[0];
    expect(wp.retry_count).toBe(2);
  });

  it("setWorkPackageSessionId sets session_id on WP", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setWorkPackageSessionId(PROJECT, "WP1", "sess-abc");
    const wp = useTaskBoardStore.getState().plans.get(PROJECT)!.work_packages[0];
    expect(wp.session_id).toBe("sess-abc");
  });

  it("reorderWorkPackages reorders by ID list", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().reorderWorkPackages(PROJECT, ["WP2", "WP1"]);
    const wps = useTaskBoardStore.getState().plans.get(PROJECT)!.work_packages;
    expect(wps[0].id).toBe("WP2");
    expect(wps[1].id).toBe("WP1");
  });

  it("addWorkPackage appends a WP", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    const newWp: WorkPackage = {
      id: "WP3", name: "Deploy", tasks: [],
      status: "planned", session_id: null, retry_count: 0,
    };
    useTaskBoardStore.getState().addWorkPackage(PROJECT, newWp);
    const wps = useTaskBoardStore.getState().plans.get(PROJECT)!.work_packages;
    expect(wps).toHaveLength(3);
    expect(wps[2].id).toBe("WP3");
  });

  // ── Task management ──

  it("updateTaskStatus changes a task's status", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().updateTaskStatus(PROJECT, "T1", "done");
    const task = useTaskBoardStore.getState().plans.get(PROJECT)!
      .work_packages[0].tasks[0];
    expect(task.status).toBe("done");
  });

  it("deleteTask removes the task from its WP", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().deleteTask(PROJECT, "T1");
    const tasks = useTaskBoardStore.getState().plans.get(PROJECT)!
      .work_packages[0].tasks;
    expect(tasks).toHaveLength(0);
  });

  // ── R5: initConversation with provider/model ──

  it("initConversation creates conversation with provider and model", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "openai", "gpt-4.1");
    const conv = useTaskBoardStore.getState().conversations.get(PROJECT)!;
    expect(conv.ai_provider).toBe("openai");
    expect(conv.ai_model).toBe("gpt-4.1");
    expect(conv.status).toBe("gathering");
    expect(conv.messages).toHaveLength(0);
  });

  // ── R2: initConversation with templateCatalog ──

  it("initConversation stores templateCatalog when provided", () => {
    const catalog = '- vite-react: "React + Vite" [frontend]';
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", catalog);
    const conv = useTaskBoardStore.getState().conversations.get(PROJECT)!;
    expect(conv.templateCatalog).toBe(catalog);
  });

  it("initConversation stores undefined templateCatalog when omitted", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    const conv = useTaskBoardStore.getState().conversations.get(PROJECT)!;
    expect(conv.templateCatalog).toBeUndefined();
  });

  // ── R5: updateConversationProvider ──

  it("updateConversationProvider changes provider and model", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().updateConversationProvider(PROJECT, "anthropic", "claude-sonnet-4-5-20250514");
    const conv = useTaskBoardStore.getState().conversations.get(PROJECT)!;
    expect(conv.ai_provider).toBe("anthropic");
    expect(conv.ai_model).toBe("claude-sonnet-4-5-20250514");
  });

  it("updateConversationProvider is a no-op for missing conversation", () => {
    useTaskBoardStore.getState().updateConversationProvider(PROJECT, "openai", "gpt-4.1");
    expect(useTaskBoardStore.getState().conversations.has(PROJECT)).toBe(false);
  });

  // ── R3: setMessageOptions ──

  it("setMessageOptions sets parsedOptions on last assistant message", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "user", content: "Build a todo app",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m2", role: "assistant", content: "What framework?",
      message_type: "conversation", timestamp: "2026-01-01T00:00:01Z",
    });
    useTaskBoardStore.getState().setMessageOptions(PROJECT, ["React", "Vue", "Svelte"]);
    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs[1].parsedOptions).toEqual(["React", "Vue", "Svelte"]);
  });

  it("setMessageOptions does nothing if last message is user", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "user", content: "Hello",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });
    useTaskBoardStore.getState().setMessageOptions(PROJECT, ["A", "B"]);
    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs[0].parsedOptions).toBeUndefined();
  });

  it("setMessageOptions does nothing for empty conversation", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().setMessageOptions(PROJECT, ["A"]);
    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs).toHaveLength(0);
  });

  // ── R4: setExecuting tracks last_executing_wp_id ──

  it("setExecuting stores executingProject and executingWorkPackage", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");
    const s = useTaskBoardStore.getState();
    expect(s.executingProject).toBe(PROJECT);
    expect(s.executingWorkPackage).toBe("WP1");
  });

  it("setExecuting updates last_executing_wp_id on the plan", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");
    const plan = useTaskBoardStore.getState().plans.get(PROJECT)!;
    expect(plan.last_executing_wp_id).toBe("WP1");
  });

  it("setExecuting(null, null) clears executing state", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setExecuting(PROJECT, "WP1");
    useTaskBoardStore.getState().setExecuting(null, null);
    const s = useTaskBoardStore.getState();
    expect(s.executingProject).toBeNull();
    expect(s.executingWorkPackage).toBeNull();
  });

  it("setExecuting with null projectPath does not touch plans", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().setExecuting(null, null);
    // Plan should still exist unmodified
    expect(useTaskBoardStore.getState().plans.get(PROJECT)!.last_executing_wp_id).toBeUndefined();
  });

  // ── Pause/Resume ──

  it("setPaused toggles isPaused", () => {
    expect(useTaskBoardStore.getState().isPaused).toBe(false);
    useTaskBoardStore.getState().setPaused(true);
    expect(useTaskBoardStore.getState().isPaused).toBe(true);
    useTaskBoardStore.getState().setPaused(false);
    expect(useTaskBoardStore.getState().isPaused).toBe(false);
  });

  // ── Planning conversation messages ──

  it("addPlanningMessage appends to conversation", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "user", content: "Build a blog",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });
    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Build a blog");
  });

  it("updateLastAssistantMessage updates content of last assistant msg", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().addPlanningMessage(PROJECT, {
      id: "m1", role: "assistant", content: "Partial...",
      message_type: "conversation", timestamp: "2026-01-01T00:00:00Z",
    });
    useTaskBoardStore.getState().updateLastAssistantMessage(PROJECT, "Full response");
    const msgs = useTaskBoardStore.getState().conversations.get(PROJECT)!.messages;
    expect(msgs[0].content).toBe("Full response");
  });

  it("setConversationStatus changes conversation status", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().setConversationStatus(PROJECT, "ready_to_plan");
    const conv = useTaskBoardStore.getState().conversations.get(PROJECT)!;
    expect(conv.status).toBe("ready_to_plan");
  });

  it("setPlanningStreaming toggles streaming state", () => {
    useTaskBoardStore.getState().setPlanningStreaming(PROJECT, true);
    expect(useTaskBoardStore.getState().planningStreaming.get(PROJECT)).toBe(true);
    useTaskBoardStore.getState().setPlanningStreaming(PROJECT, false);
    expect(useTaskBoardStore.getState().planningStreaming.get(PROJECT)).toBe(false);
  });

  // ── Project target decisions ──

  it("setProjectTarget stores decision", () => {
    useTaskBoardStore.getState().setProjectTarget(PROJECT, { type: "current_project" });
    expect(useTaskBoardStore.getState().projectTargetDecisions.get(PROJECT)).toEqual({ type: "current_project" });
  });

  // ── migratePlanToProject ──

  it("migratePlanToProject moves plan, conv, and target to new path", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash");
    useTaskBoardStore.getState().migratePlanToProject(PROJECT, PROJECT_B);

    const s = useTaskBoardStore.getState();
    expect(s.plans.has(PROJECT)).toBe(false);
    expect(s.plans.has(PROJECT_B)).toBe(true);
    expect(s.plans.get(PROJECT_B)!.project_path).toBe(PROJECT_B);
    expect(s.conversations.has(PROJECT_B)).toBe(true);
    expect(s.projectTargetDecisions.get(PROJECT)).toEqual({ type: "migrated", migratedTo: PROJECT_B });
  });

  // ── Per-project isolation ──

  it("operations on one project do not affect another", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    useTaskBoardStore.getState().createPlan(PROJECT_B, makePlan({ id: "plan-2", name: "Plan B" }));

    useTaskBoardStore.getState().updatePlanStatus(PROJECT, "executing");
    expect(useTaskBoardStore.getState().plans.get(PROJECT)!.status).toBe("executing");
    expect(useTaskBoardStore.getState().plans.get(PROJECT_B)!.status).toBe("ready");
  });

  // ── Helpers ──

  it("getActivePlan returns the plan for a project", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, makePlan());
    expect(useTaskBoardStore.getState().getActivePlan(PROJECT)?.id).toBe("plan-1");
    expect(useTaskBoardStore.getState().getActivePlan(PROJECT_B)).toBeUndefined();
  });

  it("getActiveConversation returns the conversation for a project", () => {
    useTaskBoardStore.getState().initConversation(PROJECT, "openai", "gpt-4.1");
    expect(useTaskBoardStore.getState().getActiveConversation(PROJECT)?.ai_provider).toBe("openai");
    expect(useTaskBoardStore.getState().getActiveConversation(PROJECT_B)).toBeUndefined();
  });

  it("getUIState returns defaults for unknown project", () => {
    const ui = useTaskBoardStore.getState().getUIState("/unknown");
    expect(ui.is_open).toBe(false);
    expect(ui.planning_chat_width).toBe(40);
  });
});
