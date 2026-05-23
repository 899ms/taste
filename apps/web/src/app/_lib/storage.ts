import type { RunCredentials } from "./api";

const STORAGE_KEY = "taste:activeRun";
const SKILL_HISTORY_KEY = "taste:skillGenerations:v1";
const SKILL_HISTORY_VERSION = 1;
const MAX_SKILL_HISTORY_ITEMS = 12;

export type StoredSkillGeneration = {
  id: string;
  runId: string;
  name: string;
  content: string;
  createdAt: string;
};

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

export function loadStoredSkillGenerations(): StoredSkillGeneration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SKILL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: number;
      items?: Partial<StoredSkillGeneration>[];
    };
    if (parsed.version !== SKILL_HISTORY_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.flatMap((item) => {
      if (
        typeof item.id === "string" &&
        typeof item.runId === "string" &&
        typeof item.name === "string" &&
        typeof item.content === "string" &&
        typeof item.createdAt === "string"
      ) {
        return [
          {
            id: item.id,
            runId: item.runId,
            name: item.name,
            content: item.content,
            createdAt: item.createdAt,
          },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function saveStoredSkillGeneration(input: {
  runId: string;
  content: string;
  name?: string | null | undefined;
}): boolean {
  if (typeof window === "undefined") return false;
  const name = normalizeDisplayName(input.name ?? extractSkillName(input.content));
  const record: StoredSkillGeneration = {
    id: input.runId,
    runId: input.runId,
    name,
    content: input.content,
    createdAt: new Date().toISOString(),
  };
  const existing = loadStoredSkillGenerations().filter((item) => item.runId !== input.runId);
  const items = [record, ...existing].slice(0, MAX_SKILL_HISTORY_ITEMS);
  try {
    writeSkillHistory(items);
    return true;
  } catch {
    try {
      writeSkillHistory([record]);
      return true;
    } catch {
      return false;
    }
  }
}

function writeSkillHistory(items: StoredSkillGeneration[]): void {
  window.localStorage.setItem(
    SKILL_HISTORY_KEY,
    JSON.stringify({ version: SKILL_HISTORY_VERSION, items }),
  );
}

function extractSkillName(content: string): string | null {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  const nameLine = frontmatter?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!nameLine) return null;
  try {
    if (nameLine.startsWith("\"")) {
      const parsed = JSON.parse(nameLine);
      return typeof parsed === "string" ? parsed : null;
    }
  } catch {
    return null;
  }
  return nameLine.replace(/^['"]|['"]$/g, "");
}

function normalizeDisplayName(name?: string | null): string {
  return name?.replace(/\s+/g, " ").trim() || "taste";
}
