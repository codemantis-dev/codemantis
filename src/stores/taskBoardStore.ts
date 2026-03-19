import { create } from "zustand";
import type {
  TaskPlan,
  WorkPackage,
  TaskItem,
  PlanningConversation,
  PlanningMessage,
  ProgressReview,
  TaskBoardUIState,
  CheckResult,
  ProjectTargetDecision,
} from "../types/task-board";

interface TaskBoardState {
  // Plan state (per project)
  plans: Map<string, TaskPlan>; // projectPath -> plan

  // Planning conversation (per project)
  conversations: Map<string, PlanningConversation>;

  // UI state (per project)
  uiState: Map<string, TaskBoardUIState>;

  // Execution state
  executingProject: string | null;
  executingWorkPackage: string | null;
  isPaused: boolean;

  // Streaming state for planning AI
  planningStreaming: Map<string, boolean>;

  // Project target decisions (per project)
  projectTargetDecisions: Map<string, ProjectTargetDecision>;

  // Actions - Plan management
  createPlan: (projectPath: string, plan: TaskPlan) => void;
  updatePlanStatus: (projectPath: string, status: TaskPlan['status']) => void;
  removePlan: (projectPath: string) => void;

  // Actions - Work Package management
  updateWorkPackageStatus: (projectPath: string, wpId: string, status: WorkPackage['status']) => void;
  incrementRetryCount: (projectPath: string, wpId: string) => void;
  setWorkPackageSessionId: (projectPath: string, wpId: string, sessionId: string | null) => void;
  reorderWorkPackages: (projectPath: string, orderedIds: string[]) => void;
  addWorkPackage: (projectPath: string, wp: WorkPackage) => void;

  // Actions - Task management
  updateTaskStatus: (projectPath: string, taskId: string, status: TaskItem['status']) => void;
  updateTask: (projectPath: string, taskId: string, updates: Partial<TaskItem>) => void;
  deleteTask: (projectPath: string, taskId: string) => void;
  addTask: (projectPath: string, wpId: string, task: TaskItem) => void;
  reorderTasks: (projectPath: string, wpId: string, orderedIds: string[]) => void;

  // Actions - Check results
  updateCheckResult: (projectPath: string, taskId: string, checkIndex: number, result: CheckResult) => void;

  // Actions - Planning conversation
  initConversation: (projectPath: string, provider: string, model: string, templateCatalog?: string) => void;
  addPlanningMessage: (projectPath: string, message: PlanningMessage) => void;
  updateLastAssistantMessage: (projectPath: string, content: string) => void;
  setConversationStatus: (projectPath: string, status: PlanningConversation['status']) => void;
  setPlanningStreaming: (projectPath: string, streaming: boolean) => void;
  setMessageOptions: (projectPath: string, options: string[]) => void;
  updateConversationProvider: (projectPath: string, provider: string, model: string) => void;

  // Actions - Apply AI review
  applyProgressReview: (projectPath: string, review: ProgressReview) => void;

  // Actions - UI state
  toggleSlideOver: (projectPath: string) => void;
  setSlideOverOpen: (projectPath: string, open: boolean) => void;
  setPlanningChatWidth: (projectPath: string, width: number) => void;
  setExpandedWorkPackage: (projectPath: string, wpId: string | null) => void;
  setExpandedTask: (projectPath: string, taskId: string | null) => void;

  // Actions - Project target
  setProjectTarget: (projectPath: string, decision: ProjectTargetDecision) => void;
  migratePlanToProject: (sourceProjectPath: string, targetProjectPath: string) => void;

  // Actions - Execution
  setExecuting: (projectPath: string | null, wpId: string | null) => void;
  setPaused: (paused: boolean) => void;

  // Helpers
  getActiveConversation: (projectPath: string) => PlanningConversation | undefined;
  getActivePlan: (projectPath: string) => TaskPlan | undefined;
  getUIState: (projectPath: string) => TaskBoardUIState;
}

const DEFAULT_UI_STATE: TaskBoardUIState = {
  is_open: false,
  planning_chat_width: 40,
  expanded_work_package: null,
  expanded_task: null,
  scroll_position: 0,
};

export const useTaskBoardStore = create<TaskBoardState>((set, get) => ({
  plans: new Map(),
  conversations: new Map(),
  uiState: new Map(),
  executingProject: null,
  executingWorkPackage: null,
  isPaused: false,
  planningStreaming: new Map(),
  projectTargetDecisions: new Map(),

  // Plan management
  createPlan: (projectPath, plan) =>
    set((state) => {
      const plans = new Map(state.plans);
      plans.set(projectPath, plan);
      return { plans };
    }),

  updatePlanStatus: (projectPath, status) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        plans.set(projectPath, { ...plan, status });
      }
      return { plans };
    }),

  removePlan: (projectPath) =>
    set((state) => {
      const plans = new Map(state.plans);
      plans.delete(projectPath);
      return { plans };
    }),

  // Work Package management
  updateWorkPackageStatus: (projectPath, wpId, status) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) =>
          wp.id === wpId ? { ...wp, status } : wp
        );
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  incrementRetryCount: (projectPath, wpId) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) =>
          wp.id === wpId ? { ...wp, retry_count: wp.retry_count + 1 } : wp
        );
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  setWorkPackageSessionId: (projectPath, wpId, sessionId) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) =>
          wp.id === wpId ? { ...wp, session_id: sessionId } : wp
        );
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  reorderWorkPackages: (projectPath, orderedIds) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const wpMap = new Map(plan.work_packages.map((wp) => [wp.id, wp]));
        const work_packages = orderedIds
          .map((id) => wpMap.get(id))
          .filter((wp): wp is WorkPackage => wp !== undefined);
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  addWorkPackage: (projectPath, wp) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        plans.set(projectPath, {
          ...plan,
          work_packages: [...plan.work_packages, wp],
        });
      }
      return { plans };
    }),

  // Task management
  updateTaskStatus: (projectPath, taskId, status) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.map((t) =>
            t.id === taskId ? { ...t, status } : t
          ),
        }));
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  updateTask: (projectPath, taskId, updates) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.map((t) =>
            t.id === taskId ? { ...t, ...updates } : t
          ),
        }));
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  deleteTask: (projectPath, taskId) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.filter((t) => t.id !== taskId),
        }));
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  addTask: (projectPath, wpId, task) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) =>
          wp.id === wpId ? { ...wp, tasks: [...wp.tasks, task] } : wp
        );
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  reorderTasks: (projectPath, wpId, orderedIds) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) => {
          if (wp.id !== wpId) return wp;
          const taskMap = new Map(wp.tasks.map((t) => [t.id, t]));
          const tasks = orderedIds
            .map((id) => taskMap.get(id))
            .filter((t): t is TaskItem => t !== undefined);
          return { ...wp, tasks };
        });
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  // Check results
  updateCheckResult: (projectPath, taskId, checkIndex, result) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (plan) {
        const work_packages = plan.work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const verification_checks = [...t.verification_checks];
            if (checkIndex < verification_checks.length) {
              verification_checks[checkIndex] = {
                ...verification_checks[checkIndex],
                result,
              };
            }
            return { ...t, verification_checks };
          }),
        }));
        plans.set(projectPath, { ...plan, work_packages });
      }
      return { plans };
    }),

  // Planning conversation
  initConversation: (projectPath, provider, model, templateCatalog) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      conversations.set(projectPath, {
        id: `planning-${Date.now()}`,
        plan_id: null,
        messages: [],
        ai_provider: provider,
        ai_model: model,
        status: 'gathering',
        templateCatalog,
      });
      return { conversations };
    }),

  addPlanningMessage: (projectPath, message) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, {
          ...conv,
          messages: [...conv.messages, message],
        });
      }
      return { conversations };
    }),

  updateLastAssistantMessage: (projectPath, content) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], content };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  setConversationStatus: (projectPath, status) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, status });
      }
      return { conversations };
    }),

  setPlanningStreaming: (projectPath, streaming) =>
    set((state) => {
      const planningStreaming = new Map(state.planningStreaming);
      planningStreaming.set(projectPath, streaming);
      return { planningStreaming };
    }),

  setMessageOptions: (projectPath, options) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], parsedOptions: options };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  updateConversationProvider: (projectPath, provider, model) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, ai_provider: provider, ai_model: model });
      }
      return { conversations };
    }),

  // Apply AI review
  applyProgressReview: (projectPath, review) =>
    set((state) => {
      const plans = new Map(state.plans);
      const plan = plans.get(projectPath);
      if (!plan) return {};

      let work_packages = [...plan.work_packages];

      // Apply refined tasks
      for (const refined of review.refined_tasks) {
        work_packages = work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.map((t) =>
            t.id === refined.id ? { ...t, ...refined } : t
          ),
        }));
      }

      // Remove tasks
      for (const removedId of review.removed_task_ids) {
        work_packages = work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.filter((t) => t.id !== removedId),
        }));
      }

      // Apply updated checks
      for (const uc of review.updated_checks) {
        work_packages = work_packages.map((wp) => ({
          ...wp,
          tasks: wp.tasks.map((t) => {
            if (t.id !== uc.task_id) return t;
            const checks = [...t.verification_checks];
            if (uc.check_index < checks.length) {
              checks[uc.check_index] = uc.updated_check;
            }
            return { ...t, verification_checks: checks };
          }),
        }));
      }

      // Add new tasks to last package or create supplementary
      if (review.new_tasks.length > 0) {
        const suppWp: WorkPackage = {
          id: `WP-supp-${Date.now()}`,
          name: 'Supplementary Tasks',
          tasks: review.new_tasks,
          status: 'planned',
          session_id: null,
          retry_count: 0,
        };
        work_packages.push(suppWp);
      }

      plans.set(projectPath, { ...plan, work_packages });
      return { plans };
    }),

  // UI state
  toggleSlideOver: (projectPath) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, is_open: !current.is_open });
      return { uiState };
    }),

  setSlideOverOpen: (projectPath, open) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, is_open: open });
      return { uiState };
    }),

  setPlanningChatWidth: (projectPath, width) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, planning_chat_width: width });
      return { uiState };
    }),

  setExpandedWorkPackage: (projectPath, wpId) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, expanded_work_package: wpId });
      return { uiState };
    }),

  setExpandedTask: (projectPath, taskId) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, expanded_task: taskId });
      return { uiState };
    }),

  // Project target
  setProjectTarget: (projectPath, decision) =>
    set((state) => {
      const projectTargetDecisions = new Map(state.projectTargetDecisions);
      projectTargetDecisions.set(projectPath, decision);
      return { projectTargetDecisions };
    }),

  migratePlanToProject: (sourceProjectPath, targetProjectPath) =>
    set((state) => {
      const plans = new Map(state.plans);
      const conversations = new Map(state.conversations);
      const uiState = new Map(state.uiState);
      const projectTargetDecisions = new Map(state.projectTargetDecisions);

      const sourcePlan = plans.get(sourceProjectPath);
      const sourceConv = conversations.get(sourceProjectPath);

      if (sourcePlan) {
        plans.set(targetProjectPath, { ...sourcePlan, project_path: targetProjectPath });
        plans.delete(sourceProjectPath);
      }
      if (sourceConv) {
        conversations.set(targetProjectPath, sourceConv);
        conversations.delete(sourceProjectPath);
      }

      uiState.set(targetProjectPath, { ...DEFAULT_UI_STATE, is_open: true });
      projectTargetDecisions.set(targetProjectPath, { type: 'current_project' });
      projectTargetDecisions.set(sourceProjectPath, { type: 'migrated', migratedTo: targetProjectPath });

      return { plans, conversations, uiState, projectTargetDecisions };
    }),

  // Execution
  setExecuting: (projectPath, wpId) =>
    set((state) => {
      const result: Partial<TaskBoardState> = {
        executingProject: projectPath,
        executingWorkPackage: wpId,
      };
      if (projectPath) {
        const plans = new Map(state.plans);
        const plan = plans.get(projectPath);
        if (plan) {
          plans.set(projectPath, { ...plan, last_executing_wp_id: wpId });
          result.plans = plans;
        }
      }
      return result;
    }),

  setPaused: (paused) => set({ isPaused: paused }),

  // Helpers
  getActiveConversation: (projectPath) => get().conversations.get(projectPath),
  getActivePlan: (projectPath) => get().plans.get(projectPath),
  getUIState: (projectPath) =>
    get().uiState.get(projectPath) ?? DEFAULT_UI_STATE,
}));
