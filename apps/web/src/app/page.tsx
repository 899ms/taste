"use client";

import { useCallback, useEffect, useState } from "react";

import { CreateScreen } from "./_components/CreateScreen";
import { ProcessingScreen } from "./_components/ProcessingScreen";
import { Shell } from "./_components/Shell";
import { SkillScreen } from "./_components/SkillScreen";
import { UploadScreen } from "./_components/UploadScreen";
import {
  ApiError,
  describeError,
  fetchRunStatus,
  isTerminal,
  type CreateRunResponse,
  type RunCredentials,
  type RunStatus,
} from "./_lib/api";
import { clearStoredRun, loadStoredRun, saveStoredRun } from "./_lib/storage";

type Phase =
  | { kind: "boot" }
  | { kind: "create" }
  | { kind: "uploading"; creds: RunCredentials; files: File[] }
  | { kind: "processing"; creds: RunCredentials; initialStatus?: RunStatus }
  | { kind: "complete"; creds: RunCredentials }
  | { kind: "resume_error"; creds: RunCredentials; message: string };

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });

  // Resume an active run when the app mounts.
  useEffect(() => {
    const stored = loadStoredRun();
    if (!stored) {
      setPhase({ kind: "create" });
      return;
    }
    void resumeStored(stored).then(setPhase);
  }, []);

  // Keep the favicon in sync with the phase so a backgrounded tab gets a
  // glanceable signal. The dark dot is neutral; complete swaps to accent.
  useEffect(() => {
    setFavicon(phase.kind === "complete" ? "complete" : "default");
  }, [phase.kind]);

  const handleCreated = useCallback(
    (response: CreateRunResponse, files: File[]) => {
      const creds: RunCredentials = {
        runId: response.runId,
        runSecret: response.runSecret,
      };
      saveStoredRun(creds);
      setPhase({ kind: "uploading", creds, files });
    },
    [],
  );

  const handleUploadsDone = useCallback(() => {
    setPhase((current) =>
      current.kind === "uploading" ? { kind: "processing", creds: current.creds } : current,
    );
  }, []);

  const handleProcessingComplete = useCallback(() => {
    setPhase((current) =>
      current.kind === "processing" ? { kind: "complete", creds: current.creds } : current,
    );
  }, []);

  const clearRun = useCallback(() => {
    clearStoredRun();
    setPhase({ kind: "create" });
  }, []);

  const retryResume = useCallback(() => {
    const stored = loadStoredRun();
    if (!stored) {
      setPhase({ kind: "create" });
      return;
    }
    setPhase({ kind: "boot" });
    void resumeStored(stored).then(setPhase);
  }, []);

  const activeRunId = "creds" in phase ? phase.creds.runId : undefined;
  const showClear = phase.kind !== "create" && phase.kind !== "boot";

  return (
    <Shell onClear={showClear ? clearRun : undefined} runId={activeRunId}>
      {phase.kind === "boot" && <BootCard />}
      {phase.kind === "create" && <CreateScreen onCreated={handleCreated} />}
      {phase.kind === "uploading" && (
        <UploadScreen
          creds={phase.creds}
          files={phase.files}
          onComplete={handleUploadsDone}
          onAbandon={clearRun}
        />
      )}
      {phase.kind === "processing" && (
        <ProcessingScreen
          creds={phase.creds}
          initialStatus={phase.initialStatus}
          onComplete={handleProcessingComplete}
          onAbandon={clearRun}
        />
      )}
      {phase.kind === "complete" && (
        <SkillScreen creds={phase.creds} onStartAnother={clearRun} />
      )}
      {phase.kind === "resume_error" && (
        <ResumeErrorCard message={phase.message} onRetry={retryResume} onClear={clearRun} />
      )}
    </Shell>
  );
}

async function resumeStored(creds: RunCredentials): Promise<Phase> {
  try {
    const status = await fetchRunStatus(creds);
    if (status.status === "complete" && status.artifacts.skillReady) {
      return { kind: "complete", creds };
    }
    if (status.status === "uploading") {
      // The user navigated away before uploads finished; the File objects from
      // the previous session can't be recovered, so reset to the create screen.
      clearStoredRun();
      return { kind: "create" };
    }
    // Both in-flight and terminal statuses route to the processing card —
    // terminal status renders its own error state and recovery actions.
    return { kind: "processing", creds, initialStatus: status };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      clearStoredRun();
      return { kind: "create" };
    }
    return {
      kind: "resume_error",
      creds,
      message: describeError(err, "Could not resume the run."),
    };
  }
}

type FaviconState = "default" | "complete";

function setFavicon(state: FaviconState): void {
  if (typeof document === "undefined") return;
  const color = state === "complete" ? "#2D7A4A" : "#0E0E0E";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="7" fill="${color}"/></svg>`;
  const href = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

function BootCard() {
  return (
    <section className="card">
      <p className="card__eyebrow">Loading</p>
      <h1 className="card__title">
        <span className="spinner" /> Restoring session
      </h1>
      <p className="card__sub">Checking for an active pipeline run.</p>
    </section>
  );
}

function ResumeErrorCard({
  message,
  onRetry,
  onClear,
}: {
  message: string;
  onRetry: () => void;
  onClear: () => void;
}) {
  return (
    <section className="card card--lift">
      <p className="card__eyebrow">Could not resume</p>
      <h1 className="card__title">Connection lost.</h1>
      <p className="card__sub">{message}</p>
      <div className="card__section btn-row">
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClear}>
          Clear current run
        </button>
      </div>
    </section>
  );
}
