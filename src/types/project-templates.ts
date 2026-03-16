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
