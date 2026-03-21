export interface ProjectAnalysis {
  name: string;
  description: string | null;
  framework: string | null;
  framework_version: string | null;
  language: string;
  router_type: string | null;
  css_framework: string | null;
  database: string | null;
  orm: string | null;
  auth: string | null;
  test_framework: string | null;
  state_management: string | null;
  deployment: string | null;
  scripts: [string, string][];
  env_vars: string[];
  directory_tree: string;
  key_directories: [string, string][];
  conventions: string[];
  architecture_notes: string[];
  has_monorepo: boolean;
  package_manager: string | null;
}

export type TemplateCategory = "frontend" | "full-stack" | "backend" | "mobile" | "static" | "ai";
export type ScaffoldType = "git-clone" | "cli";

export interface TemplateEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly long_description?: string;
  readonly category: TemplateCategory;
  readonly tags: readonly string[];
  readonly repo_url: string;
  readonly branch: string;
  readonly stars?: number;
  readonly license: string;
  readonly install_command: string;
  readonly dev_command: string;
  readonly dev_port?: number;
  readonly post_clone_cleanup?: readonly string[];
  readonly icon: string;
  readonly verified: boolean;
  readonly last_verified: string;
  readonly scaffold_type: ScaffoldType;
  readonly cli_command?: string;
  readonly post_commands?: readonly string[];
  readonly prerequisites?: string;
  readonly prerequisite_checks?: readonly PrerequisiteCheck[];
}

export interface PrerequisiteCheck {
  readonly command: string;
  readonly label: string;
  readonly required: boolean;
  readonly install_command?: string;
}

export interface PrerequisiteResult {
  readonly command: string;
  readonly label: string;
  readonly found: boolean;
  readonly required: boolean;
}

export interface InstallPrerequisiteResult {
  readonly success: boolean;
  readonly output: string;
}

export interface TemplateCategoryInfo {
  readonly id: TemplateCategory | "all";
  readonly label: string;
}

export const TEMPLATE_CATEGORIES: readonly TemplateCategoryInfo[] = [
  { id: "all", label: "All" },
  { id: "frontend", label: "Frontend" },
  { id: "full-stack", label: "Full-Stack" },
  { id: "backend", label: "Backend" },
  { id: "mobile", label: "Mobile" },
  { id: "static", label: "Static" },
] as const;

export type ScaffoldStepName =
  | "validate"
  | "clone"
  | "generate"
  | "clean"
  | "configure"
  | "install"
  | "verify"
  | "claude_md"
  | "commit"
  | "complete";

export type ScaffoldStepStatus = "pending" | "in_progress" | "done" | "error";

export interface ScaffoldProgressEvent {
  step: ScaffoldStepName;
  status: ScaffoldStepStatus;
  error?: string;
  output?: string;
}

export interface ScaffoldResult {
  project_path: string;
  project_name: string;
  template_id: string;
  warnings: string[];
}

export interface VerifyResult {
  template_id: string;
  success: boolean;
  duration_ms: number;
  step_failed?: string;
  error?: string;
  warnings: string[];
}

/** Steps displayed in the progress UI for git-clone scaffolds */
export const GIT_CLONE_STEPS: readonly { step: ScaffoldStepName; label: string }[] = [
  { step: "validate", label: "Validating environment" },
  { step: "clone", label: "Cloning template" },
  { step: "clean", label: "Cleaning up" },
  { step: "install", label: "Installing dependencies" },
  { step: "verify", label: "Verifying project" },
  { step: "claude_md", label: "Setting up CLAUDE.md" },
  { step: "commit", label: "Finalizing project" },
] as const;

/** Steps displayed in the progress UI for CLI-generated scaffolds (install before configure) */
export const CLI_SCAFFOLD_STEPS: readonly { step: ScaffoldStepName; label: string }[] = [
  { step: "validate", label: "Validating environment" },
  { step: "generate", label: "Generating project" },
  { step: "install", label: "Installing dependencies" },
  { step: "configure", label: "Running post-setup" },
  { step: "verify", label: "Verifying project" },
  { step: "claude_md", label: "Setting up CLAUDE.md" },
  { step: "commit", label: "Finalizing project" },
] as const;

/** Steps displayed in the progress UI for clone-from-git operations */
export const GIT_CLONE_FROM_URL_STEPS: readonly { step: ScaffoldStepName; label: string }[] = [
  { step: "validate", label: "Validating environment" },
  { step: "clone", label: "Cloning repository" },
  { step: "install", label: "Installing dependencies" },
  { step: "claude_md", label: "Generating CLAUDE.md" },
  { step: "verify", label: "Verifying project" },
] as const;
