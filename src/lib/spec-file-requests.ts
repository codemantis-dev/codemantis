// ═══════════════════════════════════════════════════════════════════════
// Spec Writer — File request detection and context injection
// Extracted from useSpecConversation.ts (HIGH-5 audit)
// ═══════════════════════════════════════════════════════════════════════

import { readProjectFiles } from "./tauri-commands";
import { FILE_REQUEST_PATTERN } from "./spec-prompts";
import type { FileReadResult } from "../types/spec-writer";

export function extractFileRequests(text: string): string[] {
  const matches = [...text.matchAll(FILE_REQUEST_PATTERN)];
  const files: string[] = [];
  for (const match of matches) {
    const paths = match[1].split(',').map(p => p.trim()).filter(Boolean);
    files.push(...paths);
  }
  // Dedupe, max 5, strip any trailing periods or colons
  return [...new Set(files)]
    .map(f => f.replace(/[.:;]+$/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function buildFileContextMessage(results: FileReadResult[]): string {
  const lines: string[] = ['--- Requested files loaded ---', ''];
  for (const r of results) {
    if (!r.found) {
      lines.push(`=== ${r.path} (NOT FOUND) ===`, '');
    } else {
      const truncNote = r.truncated ? ` (showing first 150 of ${r.totalLines} lines)` : ` (${r.totalLines} lines)`;
      lines.push(`=== ${r.path}${truncNote} ===`);
      lines.push(r.content ?? '');
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function buildFileContextUserDisplay(results: Pick<FileReadResult, 'path' | 'found' | 'totalLines' | 'truncated'>[]): string {
  const items = results.map(r => {
    if (!r.found) return `  ${r.path} — not found`;
    const note = r.truncated ? ` (first 150 of ${r.totalLines} lines)` : ` (${r.totalLines} lines)`;
    return `  ${r.path}${note}`;
  });
  return `📂 Files loaded:\n${items.join('\n')}`;
}

/**
 * Detect 📂 REQUEST_FILES markers in the response text, read the files,
 * and return the context messages to inject into the conversation.
 *
 * Returns `null` if no file requests were found.
 */
export async function handleFileRequests(
  projectPath: string,
  responseText: string,
): Promise<{
  fullContent: string;
  displayContent: string;
} | null> {
  const requestedFiles = extractFileRequests(responseText);
  if (requestedFiles.length === 0) return null;

  const results = await readProjectFiles(projectPath, requestedFiles);

  // Full content for the AI conversation
  const fullContent = buildFileContextMessage(results);

  // Abbreviated display for the user
  const displayContent = buildFileContextUserDisplay(results);

  return { fullContent, displayContent };
}
