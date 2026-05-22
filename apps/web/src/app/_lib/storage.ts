import type { RunCredentials } from "./api";

const STORAGE_KEY = "taste:activeRun";

export function loadStoredRun(): RunCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunCredentials>;
    if (parsed && typeof parsed.runId === "string" && typeof parsed.runSecret === "string") {
      return { runId: parsed.runId, runSecret: parsed.runSecret };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStoredRun(creds: RunCredentials): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearStoredRun(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
