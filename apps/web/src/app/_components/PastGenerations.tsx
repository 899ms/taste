"use client";

import { useCallback, useEffect, useState } from "react";

import {
  loadStoredSkillGenerations,
  type StoredSkillGeneration,
} from "../_lib/storage";

export function PastGenerations() {
  const [items, setItems] = useState<StoredSkillGeneration[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    setItems(loadStoredSkillGenerations());
  }, []);

  const handleCopy = useCallback(async (item: StoredSkillGeneration) => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopyError(null);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopyError("Clipboard access was blocked.");
    }
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="past" aria-label="Past generations">
      <div className="past__head">
        <h2 className="past__title">Past generations</h2>
      </div>
      <div className="past__list">
        {items.map((item) => (
          <article className="past__item" key={item.id}>
            <div className="past__meta">
              <h3 className="past__name">{item.name}</h3>
              <p className="past__date">{formatGenerationDate(item.createdAt)}</p>
            </div>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => void handleCopy(item)}
            >
              {copiedId === item.id ? "Copied" : "Copy"}
            </button>
          </article>
        ))}
      </div>
      {copyError && <p className="notice">{copyError}</p>}
    </section>
  );
}

function formatGenerationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
