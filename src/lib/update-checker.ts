import type { Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";

/** Module-scoped reference to the Update object (has downloadAndInstall method). */
let pendingUpdate: Update | null = null;

export interface UpdateInfo {
  version: string;
  body: string | null;
}

/** Check for updates. Returns info if available, null otherwise. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const result = await check();
  if (result) {
    pendingUpdate = result;
    return { version: result.version, body: result.body ?? null };
  }
  return null;
}

/** Get the stored Update object for download+install. */
export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

/** Clear the stored update (e.g. after dismiss). */
export function clearPendingUpdate(): void {
  pendingUpdate = null;
}
