// buildSystemPrompt — composes the SpecWriter system message for a given mode.

import { NEW_APP_PROMPT } from "./new-app-mode";
import { FEATURE_MODE_PROMPT } from "./feature-mode";

export function buildSystemPrompt(mode: 'new_application' | 'feature', templateCatalog: string, projectContext: string): string {
  if (mode === 'feature' && projectContext) {
    return FEATURE_MODE_PROMPT
      .replace('{PROJECT_CONTEXT}', projectContext)
      .replace('{TEMPLATE_CATALOG}', templateCatalog);
  }
  return NEW_APP_PROMPT.replace('{TEMPLATE_CATALOG}', templateCatalog);
}
