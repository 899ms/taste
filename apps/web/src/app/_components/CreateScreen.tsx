"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  cancelRun,
  createRun,
  describeError,
  PRE_CREATE_ACCEPTED_TYPES,
  PRE_CREATE_IMAGE_BYTES_CAP,
  PRE_CREATE_IMAGE_CAP,
  type CreateRunResponse,
} from "../_lib/api";
import { formatBytes } from "../_lib/format";
import { Dropzone } from "./Dropzone";

type SelectedFile = {
  id: string;
  file: File;
};

type CreateScreenProps = {
  onCreated: (response: CreateRunResponse, files: File[]) => void;
};

export function CreateScreen({ onCreated }: CreateScreenProps) {
  const [token, setToken] = useState("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalBytes = useMemo(
    () => files.reduce((acc, f) => acc + f.file.size, 0),
    [files],
  );

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError(null);
    const next: SelectedFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(incoming)) {
      if (!isAcceptedType(file.type)) {
        rejected.push(`${file.name}: unsupported image type`);
        continue;
      }
      if (file.size > PRE_CREATE_IMAGE_BYTES_CAP) {
        rejected.push(`${file.name}: larger than ${formatBytes(PRE_CREATE_IMAGE_BYTES_CAP)}`);
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
      });
    }
    if (rejected.length > 0) {
      setError(rejected.slice(0, 3).join("; "));
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      for (const item of next) {
        if (!seen.has(item.id)) {
          merged.push(item);
          seen.add(item.id);
        }
      }
      return merged.slice(0, PRE_CREATE_IMAGE_CAP);
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const localError = validateLocally(token, files);
    if (localError) {
      setError(localError);
      return;
    }
    setSubmitting(true);
    try {
      const response = await createRun({
        aiGatewayToken: token.trim(),
        expectedImageCount: files.length,
      });
      const serverError = validateAgainstServer(files, response);
      if (serverError) {
        setError(serverError);
        // Best-effort cleanup of the just-created run so the server isn't
        // left holding a stale shell. The user can still continue locally if
        // this fails for any reason.
        await cancelRun({ runId: response.runId, runSecret: response.runSecret }).catch(() => {});
        setSubmitting(false);
        return;
      }
      onCreated(response, files.map((f) => f.file));
    } catch (err) {
      setError(describeError(err, "Could not create the run."));
      setSubmitting(false);
    }
  }, [files, onCreated, token]);

  return (
    <section className="card card--lift">
      <p className="card__eyebrow">New run</p>
      <h1 className="card__title">Turn reference images into a taste skill.</h1>
      <p className="card__sub">
        Provide an AI Gateway token, drop in your corpus, and the pipeline will
        produce a single reusable SKILL.md you can keep.
      </p>

      <div className="card__section">
        <label className="field" htmlFor="ai-token">
          <span className="field__label">AI Gateway token</span>
          <input
            id="ai-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="input input--mono"
            placeholder="sk-aigw-…"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={submitting}
          />
          <span className="field__hint">
            The token is used only for this run and never stored after the pipeline finishes.
          </span>
        </label>
      </div>

      <div className="card__section">
        <Dropzone
          active={dragActive}
          disabled={submitting}
          fileCount={files.length}
          totalBytes={totalBytes}
          onActiveChange={setDragActive}
          onSelect={addFiles}
          onClick={() => inputRef.current?.click()}
        />
        <input
          ref={inputRef}
          type="file"
          accept={PRE_CREATE_ACCEPTED_TYPES.join(",")}
          multiple
          className="dropzone__input"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="filelist" aria-label="Selected images">
          {files.map((item) => (
            <li key={item.id} className="filerow">
              <div className="filerow__text">
                <span className="filerow__name">{item.file.name}</span>
                <span className="filerow__meta">{formatBytes(item.file.size)}</span>
              </div>
              <span className="filerow__status">Ready</span>
              <button
                type="button"
                aria-label={`Remove ${item.file.name}`}
                className="filerow__remove"
                onClick={() => removeFile(item.id)}
                disabled={submitting}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="notice">{error}</p>}

      <div className="card__section btn-row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSubmit}
          disabled={submitting || files.length === 0 || !token.trim()}
        >
          {submitting ? (
            <>
              <span className="spinner" /> Preparing
            </>
          ) : (
            "Start run"
          )}
        </button>
        <span className="btn-row__caption muted">
          {files.length} {files.length === 1 ? "image" : "images"} ready
        </span>
      </div>
    </section>
  );
}

function isAcceptedType(type: string): boolean {
  return (PRE_CREATE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

function validateLocally(token: string, files: SelectedFile[]): string | null {
  if (!token.trim()) return "Enter your AI Gateway token to continue.";
  if (files.length === 0) return "Add at least one reference image.";
  if (files.length > PRE_CREATE_IMAGE_CAP) {
    return `This pipeline accepts up to ${PRE_CREATE_IMAGE_CAP} images per run.`;
  }
  const oversized = files.find((item) => item.file.size > PRE_CREATE_IMAGE_BYTES_CAP);
  if (oversized) {
    return `${oversized.file.name} is larger than ${formatBytes(PRE_CREATE_IMAGE_BYTES_CAP)}.`;
  }
  return null;
}

function validateAgainstServer(
  files: SelectedFile[],
  response: CreateRunResponse,
): string | null {
  if (files.length > response.maxImages) {
    return `This pipeline accepts up to ${response.maxImages} images per run.`;
  }
  const disallowed = files.find((item) => !response.acceptedTypes.includes(item.file.type));
  if (disallowed) return `${disallowed.file.name} is not an accepted image type.`;
  const tooLarge = files.find((item) => item.file.size > response.maxImageBytes);
  if (tooLarge) {
    return `${tooLarge.file.name} is larger than ${formatBytes(response.maxImageBytes)}.`;
  }
  return null;
}
