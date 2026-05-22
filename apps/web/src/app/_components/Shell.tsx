"use client";

import type { ReactNode } from "react";

import { truncateId } from "../_lib/format";

type ShellProps = {
  children: ReactNode;
  eyebrow?: string | undefined;
  onClear?: (() => void) | undefined;
  runId?: string | undefined;
};

export function Shell({ children, eyebrow, onClear, runId }: ShellProps) {
  return (
    <div className="shell">
      <header className="shell__head">
        <span className="shell__mark">
          <span className="shell__dot" aria-hidden />
          Taste
        </span>
        {eyebrow ? <span className="shell__eyebrow">{eyebrow}</span> : null}
      </header>
      <main className="shell__main">{children}</main>
      {(runId || onClear) && (
        <footer className="shell__foot">
          <span className="mono">{runId ? truncateId(runId) : ""}</span>
          {onClear ? (
            <button type="button" className="btn btn--ghost" onClick={onClear}>
              Clear current run
            </button>
          ) : (
            <span />
          )}
        </footer>
      )}
    </div>
  );
}
