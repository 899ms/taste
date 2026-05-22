import type { RunEvent } from "./api";

const EVENT_BUFFER_LIMIT = 200;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / 10 ** (exp * 3);
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
}

export function formatStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function formatCount(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  return value.toString();
}

export function formatFraction(numerator?: number, denominator?: number): string {
  const n = numerator ?? 0;
  const d = denominator ?? 0;
  if (d === 0 && n === 0) return "—";
  if (d === 0) return n.toString();
  return `${n} / ${d}`;
}

export function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function mergeEvents(prev: RunEvent[], next: RunEvent[]): RunEvent[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((e) => e.id));
  const merged = [...prev];
  for (const event of next) {
    if (!seen.has(event.id)) {
      merged.push(event);
      seen.add(event.id);
    }
  }
  merged.sort((a, b) => a.id - b.id);
  // Keep the buffer bounded so memory doesn't grow unbounded for long runs.
  return merged.slice(-EVENT_BUFFER_LIMIT);
}
