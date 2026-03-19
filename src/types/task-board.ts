export interface TaskPlan {
  id: string;
  name: string;
  description: string;
  template_recommendation: string | null;
  work_packages: WorkPackage[];
  created_at: string;
  status: 'planning' | 'ready' | 'executing' | 'done' | 'error';
  project_path: string;
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
}

export interface PlanningMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: PlanningAttachment[];
  message_type: 'conversation' | 'progress_update' | 'gap_review' | 'user_feedback';
  timestamp: string;
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
