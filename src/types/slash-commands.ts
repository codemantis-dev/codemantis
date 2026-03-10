export interface SlashCommand {
  name: string;
  description: string;
  category: "skill" | "built-in" | "cli-only";
  source_path: string | null;
  argument_hint: string | null;
  model: string | null;
  user_invocable: boolean;
}

export interface ExpandedSkill {
  prompt: string;
  allowed_tools: string[] | null;
  model: string | null;
  context_fork: boolean;
}

export interface OneshotResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
}
