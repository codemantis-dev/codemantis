import type { ImplementationGuide } from "../types/implementation-guide";

/**
 * Returns true if the guide has been started — any session prompt sent,
 * verification requested, verify check toggled, or session completed.
 *
 * Does NOT check Self-Drive status (lives in selfDriveStore).
 * Callers must check selfDriveStatus separately.
 */
export function isGuideStarted(guide: ImplementationGuide): boolean {
  return guide.sessions.some(
    (s) =>
      s.status === "done" ||
      s.promptSent === true ||
      s.verifyRequested === true ||
      s.verifyChecks.some((c) => c.checked),
  );
}
