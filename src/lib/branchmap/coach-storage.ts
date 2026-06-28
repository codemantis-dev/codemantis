// Persistence for one-time Branch Map coaching tips (localStorage-backed).

function storageKey(key: string): string {
  return `branchmap.coach.${key}`;
}

export function isCoachTipDismissed(key: string): boolean {
  try {
    return localStorage.getItem(storageKey(key)) === "1";
  } catch {
    return false;
  }
}

export function dismissCoachTip(key: string): void {
  try {
    localStorage.setItem(storageKey(key), "1");
  } catch {
    /* non-fatal */
  }
}
