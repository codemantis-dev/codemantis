import type { Observation } from "../types/super-bro";

export interface ParsedSuperBroResponse {
  guidance: string;
  suggestedPrompt: string | null;
  fileCheckRequest: string | null;
  observations: Observation[];
  isNothingToReport: boolean;
}

const NOTHING_TO_REPORT = "NOTHING_TO_REPORT";

const SUGGESTED_PROMPT_RE =
  /<suggested-prompt>\s*([\s\S]*?)\s*<\/suggested-prompt>/;
const CHECK_FILE_RE = /<check-file>\s*([\s\S]*?)\s*<\/check-file>/;
const OBSERVATION_RE =
  /<observation\s+category="(pattern|preference|issue|project_note)">\s*([\s\S]*?)\s*<\/observation>/g;

export function parseSuperBroResponse(text: string): ParsedSuperBroResponse {
  const trimmed = text.trim();

  // Check for the silence sentinel
  if (trimmed === NOTHING_TO_REPORT) {
    return {
      guidance: "",
      suggestedPrompt: null,
      fileCheckRequest: null,
      observations: [],
      isNothingToReport: true,
    };
  }

  // Extract suggested prompt
  const promptMatch = trimmed.match(SUGGESTED_PROMPT_RE);
  const suggestedPrompt = promptMatch?.[1]?.trim() ?? null;

  // Extract file check request
  const fileCheckMatch = trimmed.match(CHECK_FILE_RE);
  const fileCheckRequest = fileCheckMatch?.[1]?.trim() ?? null;

  // Extract observations
  const observations: Observation[] = [];
  let obsMatch: RegExpExecArray | null;
  // Reset lastIndex for global regex
  OBSERVATION_RE.lastIndex = 0;
  while ((obsMatch = OBSERVATION_RE.exec(trimmed)) !== null) {
    const now = new Date().toISOString();
    observations.push({
      id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: obsMatch[2].trim(),
      category: obsMatch[1] as Observation["category"],
      createdAt: now,
      lastReferencedAt: now,
    });
  }

  // Clean guidance text: remove all tags
  const guidance = trimmed
    .replace(/<suggested-prompt>[\s\S]*?<\/suggested-prompt>/g, "")
    .replace(/<check-file>[\s\S]*?<\/check-file>/g, "")
    .replace(
      /<observation\s+category="[^"]*">[\s\S]*?<\/observation>/g,
      "",
    )
    .trim();

  return {
    guidance,
    suggestedPrompt,
    fileCheckRequest,
    observations,
    isNothingToReport: false,
  };
}
