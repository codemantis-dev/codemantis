export interface TaskPlan {
  id: string;
  name: string;
  description: string;
  template_recommendation: string | null;
  work_packages: WorkPackage[];
  created_at: string;
  status: 'planning' | 'ready' | 'executing' | 'done' | 'error';
  project_path: string;
  last_executing_wp_id?: string | null;
}

export interface WorkPackage {
  id: string;
  name: string;
  tasks: TaskItem[];
  status: 'planned' | 'in_progress' | 'verifying' | 'done' | 'needs_review';
  session_id: string | null;
  retry_count: number;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  verification_checks: VerificationCheck[];
  work_package: string;
  depends_on: string[];
  status: 'planned' | 'in_progress' | 'done' | 'failed' | 'skipped';
  requires_user_action?: string | null;
}

export type VerificationCheckType = 'file_exists' | 'file_contains' | 'grep_codebase' | 'command_succeeds' | 'dom_check';
export type DomAssertion = 'exists' | 'visible' | 'has_text' | 'has_options' | 'count_gte' | 'not_exists';

export interface VerificationCheck {
  type: VerificationCheckType;
  path?: string;
  pattern?: string;
  command?: string;
  route?: string;
  selector?: string;
  assertion?: DomAssertion;
  expected?: string | number;
  description: string;
  result?: CheckResult;
}

export interface CheckResult {
  passed: boolean;
  evidence: string;
  checked_at: string;
}

export interface PlanningConversation {
  id: string;
  plan_id: string | null;
  messages: PlanningMessage[];
  ai_provider: string;
  ai_model: string;
  status: 'gathering' | 'ready_to_plan' | 'planning' | 'monitoring' | 'reviewing';
  templateCatalog?: string;
}

export interface PlanningMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: PlanningAttachment[];
  message_type: 'conversation' | 'progress_update' | 'gap_review' | 'user_feedback' | 'user_action_required';
  timestamp: string;
  parsedOptions?: string[];
}

export interface PlanningAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  size: number;
  mime_type: string;
  preview_url?: string;
  text_content?: string;
  file_path: string;
}

export interface ProjectSnapshot {
  files_changed: FileChange[];
  new_files: string[];
  deleted_files: string[];
  file_tree: string;
  package_json_deps: string[];
  route_list: string[];
  check_results: CheckResult[];
  console_errors: ConsoleLogEntry[];
  console_warnings: ConsoleLogEntry[];
  file_contents?: { path: string; content: string }[];
  page_screenshots?: { route: string; image_base64: string }[];
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  insertions: number;
  deletions: number;
}

export interface ConsoleLogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  ts: string;
  msg: string;
  url: string;
  stack?: string;
}

export interface ProgressReview {
  assessment: 'on_track' | 'needs_refinement' | 'has_gaps';
  refined_tasks: TaskItem[];
  new_tasks: TaskItem[];
  removed_task_ids: string[];
  updated_checks: {
    task_id: string;
    check_index: number;
    updated_check: VerificationCheck;
  }[];
  notes: string;
}

export interface TaskBoardUIState {
  is_open: boolean;
  planning_chat_width: number;
  expanded_work_package: string | null;
  expanded_task: string | null;
  scroll_position: number;
}

export type ProjectTargetDecision =
  | { type: 'undecided' }
  | { type: 'current_project' }
  | { type: 'new_project'; targetPath: string }
  | { type: 'migrated'; migratedTo: string };

/** Raw row from the Rust backend (serde camelCase). */
export interface TaskPlanSummaryRow {
  id: string;
  projectPath: string;
  status: string;
  planJson: string;
  createdAt: string;
  updatedAt: string;
}

/** Parsed summary for display. */
export interface TaskPlanSummary {
  id: string;
  projectPath: string;
  status: 'active' | 'archived';
  planName: string;
  planStatus: TaskPlan['status'];
  wpCount: number;
  doneTasks: number;
  totalTasks: number;
  createdAt: string;
  updatedAt: string;
}

/** Parse a raw DB row into a display-ready summary. */
export function parsePlanSummary(row: TaskPlanSummaryRow): TaskPlanSummary {
  let planName = 'Unnamed Plan';
  let planStatus: TaskPlan['status'] = 'planning';
  let wpCount = 0;
  let doneTasks = 0;
  let totalTasks = 0;

  try {
    const parsed = JSON.parse(row.planJson);
    // The persisted blob may be the full TaskBoardState { plan, conversation, projectTarget }
    // or a raw TaskPlan. Handle both.
    const plan = parsed.plan ?? parsed;
    if (plan.name) planName = plan.name;
    if (plan.status) planStatus = plan.status;
    if (Array.isArray(plan.work_packages)) {
      wpCount = plan.work_packages.length;
      for (const wp of plan.work_packages) {
        if (Array.isArray(wp.tasks)) {
          totalTasks += wp.tasks.length;
          doneTasks += wp.tasks.filter((t: { status: string }) => t.status === 'done').length;
        }
      }
    }
  } catch {
    // JSON parse failed — use defaults
  }

  return {
    id: row.id,
    projectPath: row.projectPath,
    status: row.status === 'archived' ? 'archived' : 'active',
    planName,
    planStatus,
    wpCount,
    doneTasks,
    totalTasks,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
