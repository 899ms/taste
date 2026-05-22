"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  describeError,
  fetchRunEvents,
  fetchRunStatus,
  isTerminal,
  type RunCredentials,
  type RunEvent,
  type RunStatus,
} from "../_lib/api";
import {
  formatCount,
  formatFraction,
  formatStatus,
  formatTime,
  mergeEvents,
} from "../_lib/format";

const POLL_INTERVAL_MS = 2000;
const MAX_VISIBLE_EVENTS = 8;

type ProcessingScreenProps = {
  creds: RunCredentials;
  initialStatus?: RunStatus | undefined;
  onComplete: () => void;
  onAbandon: () => void;
};

export function ProcessingScreen({
  creds,
  initialStatus,
  onComplete,
  onAbandon,
}: ProcessingScreenProps) {
  const [status, setStatus] = useState<RunStatus | null>(initialStatus ?? null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const lastEventIdRef = useRef(0);
  const completionFiredRef = useRef(false);

  const tick = useCallback(async () => {
    try {
      const [nextStatus, nextEvents] = await Promise.all([
        fetchRunStatus(creds),
        fetchRunEvents(creds, lastEventIdRef.current),
      ]);
      setStatus(nextStatus);
      setPollError(null);
      if (nextEvents.length > 0) {
        lastEventIdRef.current = Math.max(
          lastEventIdRef.current,
          ...nextEvents.map((e) => e.id),
        );
        setEvents((prev) => mergeEvents(prev, nextEvents));
      }
      if (
        nextStatus.status === "complete" &&
        nextStatus.artifacts.skillReady &&
        !completionFiredRef.current
      ) {
        completionFiredRef.current = true;
        onComplete();
      }
    } catch (err) {
      setPollError(describeError(err, "Lost connection. Will keep trying."));
    }
  }, [creds, onComplete]);

  // Kick a fetch immediately so the screen never shows empty data.
  useEffect(() => {
    void tick();
  }, [tick]);

  // Poll on an interval while the run is still in progress.
  useEffect(() => {
    if (paused) return;
    if (status && isTerminal(status.status)) return;
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused, status, tick]);

  // Tab title mirrors progress so a backgrounded tab can be glanced at.
  useEffect(() => {
    if (!status) {
      document.title = "Taste";
      return;
    }
    if (status.status === "failed" || status.status === "canceled") {
      document.title = "Failed · Taste";
    } else if (status.status === "complete") {
      document.title = "✓ Taste";
    } else {
      document.title = `${status.progressPercent}% · Taste`;
    }
    return () => {
      document.title = "Taste";
    };
  }, [status]);

  const recentEvents = useMemo(
    () => events.slice(-MAX_VISIBLE_EVENTS).reverse(),
    [events],
  );

  const failed = status?.status === "failed" || status?.status === "canceled";
  const progress = status?.progressPercent ?? 0;
  const isComplete = status?.status === "complete";

  return (
    <section className="card card--lift">
      <p className="card__eyebrow">Pipeline</p>
      <div className="row row--baseline">
        <div className="metric">
          <span className="bigvalue">{failed ? "—" : progress}</span>
          {!failed && <span className="bigvalue__unit">%</span>}
        </div>
        <StatusPill status={status} failed={failed} pollError={pollError} />
      </div>
      <p className="card__sub card__sub--after-row" aria-live="polite">
        {failed
          ? status?.errorMessage ?? "The pipeline stopped before completing."
          : status?.currentStep ?? "Connecting to the run…"}
      </p>

      <div className="card__section">
        <div className="progress" aria-label="Pipeline progress">
          <div
            className={progressFillClass(failed, isComplete)}
            style={{ width: failed ? "0%" : `${Math.max(2, progress)}%` }}
          />
        </div>
      </div>

      <div className="stats">
        <StatRow label="Images" value={formatCount(status?.counts.images)} />
        <StatRow
          label="Raw analyses"
          value={formatFraction(status?.counts.rawAnalyses, status?.counts.rawAnalysisTotal)}
        />
        <StatRow
          label="Synthesized notes"
          value={formatFraction(status?.counts.synthesizedNotes, status?.counts.images)}
        />
        <StatRow
          label="Rule chunks"
          value={formatFraction(status?.counts.ruleChunks, status?.counts.ruleChunkTotal)}
        />
      </div>

      {recentEvents.length > 0 && (
        <div className="events" aria-label="Recent events">
          <p className="events__title">Recent activity</p>
          {recentEvents.map((event) => (
            <div className="event" key={event.id}>
              <span className="event__time">{formatTime(event.createdAt)}</span>
              <span className="event__msg">{event.message}</span>
            </div>
          ))}
        </div>
      )}

      {pollError && (
        <div className="notice">
          {pollError}
          <div className="notice__actions">
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setPollError(null);
                void tick();
              }}
            >
              Retry now
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume polling" : "Pause polling"}
            </button>
          </div>
        </div>
      )}

      {failed && (
        <div className="card__section btn-row">
          <button type="button" className="btn btn--primary" onClick={onAbandon}>
            Start a new run
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              completionFiredRef.current = false;
              void tick();
            }}
          >
            Refresh status
          </button>
        </div>
      )}
    </section>
  );
}

function progressFillClass(failed: boolean, isComplete: boolean): string {
  const parts = ["progress__fill"];
  if (failed) parts.push("progress__fill--idle");
  if (isComplete) parts.push("progress__fill--complete");
  return parts.join(" ");
}

function StatusPill({
  status,
  failed,
  pollError,
}: {
  status: RunStatus | null;
  failed: boolean;
  pollError: string | null;
}) {
  if (failed) {
    return (
      <span className="statuspill statuspill--err">
        <span className="statuspill__dot" /> {status ? formatStatus(status.status) : "Failed"}
      </span>
    );
  }
  if (pollError) {
    return (
      <span className="statuspill">
        <span className="statuspill__dot" /> Reconnecting
      </span>
    );
  }
  if (!status) {
    return (
      <span className="statuspill">
        <span className="statuspill__dot" /> Loading
      </span>
    );
  }
  if (status.status === "complete") {
    return (
      <span className="statuspill statuspill--done">
        <span className="statuspill__dot" /> Complete
      </span>
    );
  }
  return (
    <span className="statuspill statuspill--live">
      <span className="statuspill__dot" /> {formatStatus(status.status)}
    </span>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}
