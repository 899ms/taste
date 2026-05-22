import { and, asc, count, eq, gt, isNull } from "drizzle-orm";

import { env } from "@/config";
import { createSecret, decryptSecret, encryptSecret, hashSecret, safeEqualHash } from "@/crypto/secrets";
import { db } from "./client";
import {
  artifacts,
  referenceImages,
  runEvents,
  runs,
  type Artifact,
  type NewArtifact,
  type ReferenceImage,
  type Run,
  type RunEvent,
} from "./schema";

export type RunStatus =
  | "uploading"
  | "queued"
  | "indexing"
  | "analyzing"
  | "synthesizing_notes"
  | "extracting_rules"
  | "generating_skill"
  | "complete"
  | "failed"
  | "canceled";

export async function createRun(input: {
  aiGatewayToken?: string | undefined;
  expectedImageCount?: number | undefined;
}) {
  const runSecret = createSecret();
  const encrypted = input.aiGatewayToken
    ? encryptSecret(input.aiGatewayToken, env().APP_ENCRYPTION_KEY)
    : null;
  const [run] = await db
    .insert(runs)
    .values({
      runSecretHash: hashSecret(runSecret),
      encryptedAiGatewayToken: encrypted?.ciphertext ?? null,
      aiGatewayTokenIv: encrypted?.iv ?? null,
      aiGatewayTokenTag: encrypted?.tag ?? null,
      expectedImageCount: input.expectedImageCount,
      maxImages: env().MAX_IMAGES_PER_RUN,
    })
    .returning();
  if (!run) throw new Error("Failed to create run");
  await appendRunEvent(run.id, "run.created", "Run created");
  return { run, runSecret };
}

export async function getRun(runId: string): Promise<Run | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  return run ?? null;
}

export async function requireRun(runId: string): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  return run;
}

export async function verifyRunSecret(runId: string, runSecret: string): Promise<Run> {
  const run = await requireRun(runId);
  if (!safeEqualHash(runSecret, run.runSecretHash)) {
    throw new Error("Invalid run secret");
  }
  return run;
}

export function decryptRunToken(run: Pick<Run, "encryptedAiGatewayToken" | "aiGatewayTokenIv" | "aiGatewayTokenTag">): string {
  if (!run.encryptedAiGatewayToken || !run.aiGatewayTokenIv || !run.aiGatewayTokenTag) {
    return "";
  }
  return decryptSecret(
    {
      ciphertext: run.encryptedAiGatewayToken,
      iv: run.aiGatewayTokenIv,
      tag: run.aiGatewayTokenTag,
    },
    env().APP_ENCRYPTION_KEY,
  );
}

export async function purgeRunToken(runId: string) {
  await db
    .update(runs)
    .set({
      encryptedAiGatewayToken: null,
      aiGatewayTokenIv: null,
      aiGatewayTokenTag: null,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  fields: Partial<Pick<Run, "currentStep" | "errorMessage" | "progressPercent" | "completedAt">> = {},
) {
  await db
    .update(runs)
    .set({
      status,
      ...fields,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function failRun(runId: string, error: unknown) {
  const run = await getRun(runId);
  if (run?.status === "canceled" || run?.status === "complete") return;
  const message = error instanceof Error ? error.message : String(error);
  await updateRunStatus(runId, "failed", {
    currentStep: "Failed",
    errorMessage: message,
  });
  await purgeRunToken(runId);
  await appendRunEvent(runId, "run.failed", message);
}

export async function cancelRun(runId: string) {
  const run = await requireRun(runId);
  if (run.status === "complete" || run.status === "canceled") {
    await purgeRunToken(runId);
    return run;
  }
  await updateRunStatus(runId, "canceled", {
    currentStep: "Canceled",
    progressPercent: run.progressPercent,
    completedAt: new Date(),
  });
  await purgeRunToken(runId);
  await appendRunEvent(runId, "run.canceled", "Run canceled");
  return requireRun(runId);
}

export async function registerUploadedImage(input: {
  runId: string;
  uploadOrder: number;
  basename: string;
  blobUrl: string;
  downloadUrl?: string | null | undefined;
  pathname: string;
  contentType: string;
  bytes: number;
}) {
  const [image] = await db
    .insert(referenceImages)
    .values({
      runId: input.runId,
      uploadOrder: input.uploadOrder,
      basename: input.basename,
      blobUrl: input.blobUrl,
      downloadUrl: input.downloadUrl ?? null,
      pathname: input.pathname,
      contentType: input.contentType,
      bytes: input.bytes,
    })
    .onConflictDoUpdate({
      target: [referenceImages.runId, referenceImages.pathname],
      set: {
        uploadOrder: input.uploadOrder,
        basename: input.basename,
        blobUrl: input.blobUrl,
        downloadUrl: input.downloadUrl ?? null,
        contentType: input.contentType,
        bytes: input.bytes,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!image) throw new Error("Failed to register uploaded image");
  await appendRunEvent(input.runId, "image.uploaded", `Uploaded ${input.basename}`, {
    pathname: input.pathname,
    bytes: input.bytes,
  });
  return image;
}

export async function listImages(runId: string): Promise<ReferenceImage[]> {
  return db
    .select()
    .from(referenceImages)
    .where(eq(referenceImages.runId, runId))
    .orderBy(asc(referenceImages.uploadOrder), asc(referenceImages.createdAt));
}

export async function listActiveImages(runId: string): Promise<ReferenceImage[]> {
  return db
    .select()
    .from(referenceImages)
    .where(and(eq(referenceImages.runId, runId), eq(referenceImages.isDuplicate, false)))
    .orderBy(asc(referenceImages.uploadOrder), asc(referenceImages.createdAt));
}

export async function getImageByImageId(runId: string, imageId: string): Promise<ReferenceImage> {
  const [image] = await db
    .select()
    .from(referenceImages)
    .where(and(eq(referenceImages.runId, runId), eq(referenceImages.imageId, imageId)))
    .limit(1);
  if (!image) throw new Error(`Image not found: ${imageId}`);
  return image;
}

export async function updateImageIndex(input: {
  rowId: string;
  imageId: string | null;
  sha256: string;
  width: number | null;
  height: number | null;
  isDuplicate: boolean;
  duplicateOfImageId: string | null;
}) {
  await db
    .update(referenceImages)
    .set({
      imageId: input.imageId,
      sha256: input.sha256,
      width: input.width,
      height: input.height,
      isDuplicate: input.isDuplicate,
      duplicateOfImageId: input.duplicateOfImageId,
      updatedAt: new Date(),
    })
    .where(eq(referenceImages.id, input.rowId));
}

export async function setRunIndexed(input: {
  runId: string;
  imageCount: number;
  analysisTotal: number;
}) {
  await db
    .update(runs)
    .set({
      status: "analyzing",
      imageCount: input.imageCount,
      analysisTotal: input.analysisTotal,
      currentStep: "Analyzing reference images",
      progressPercent: 5,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, input.runId));
}

export async function setRawAnalysisCount(runId: string, value: number) {
  await db
    .update(runs)
    .set({
      rawAnalysisCount: value,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function setSynthesizedNoteCount(runId: string, value: number) {
  await db
    .update(runs)
    .set({
      status: "synthesizing_notes",
      synthesizedNoteCount: value,
      currentStep: "Synthesizing image notes",
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function setRuleChunkTotal(runId: string, total: number) {
  await db
    .update(runs)
    .set({
      ruleChunkTotal: total,
      ruleChunkCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function setRuleChunkCount(runId: string, value: number) {
  await db
    .update(runs)
    .set({
      ruleChunkCount: value,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function claimStatus(runId: string, from: RunStatus, to: RunStatus, currentStep: string) {
  const claimed = await db
    .update(runs)
    .set({
      status: to,
      currentStep,
      updatedAt: new Date(),
    })
    .where(and(eq(runs.id, runId), eq(runs.status, from)))
    .returning({ id: runs.id });
  return claimed.length > 0;
}

export async function storeArtifact(input: NewArtifact): Promise<Artifact> {
  const [artifact] = await db
    .insert(artifacts)
    .values(input)
    .onConflictDoUpdate({
      target: [
        artifacts.runId,
        artifacts.type,
        artifacts.imageId,
        artifacts.model,
        artifacts.chunkId,
      ],
      set: {
        blobUrl: input.blobUrl ?? null,
        pathname: input.pathname ?? null,
        content: input.content ?? null,
        bytes: input.bytes ?? 0,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      },
    })
    .returning();
  if (!artifact) throw new Error("Failed to store artifact");
  return artifact;
}

export async function listArtifacts(runId: string, type: string): Promise<Artifact[]> {
  return db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.type, type)))
    .orderBy(asc(artifacts.imageId), asc(artifacts.chunkId), asc(artifacts.model));
}

export async function getArtifact(input: {
  runId: string;
  type: string;
  imageId?: string;
  model?: string;
  chunkId?: string;
}): Promise<Artifact | null> {
  const clauses = [eq(artifacts.runId, input.runId), eq(artifacts.type, input.type)];
  if (input.imageId !== undefined) clauses.push(eq(artifacts.imageId, input.imageId));
  if (input.model !== undefined) clauses.push(eq(artifacts.model, input.model));
  if (input.chunkId !== undefined) clauses.push(eq(artifacts.chunkId, input.chunkId));
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(and(...clauses))
    .limit(1);
  return artifact ?? null;
}

export async function countArtifacts(runId: string, type: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.type, type)));
  return row?.value ?? 0;
}

export async function appendRunEvent(
  runId: string,
  type: string,
  message: string,
  data: Record<string, unknown> = {},
): Promise<RunEvent> {
  const [event] = await db
    .insert(runEvents)
    .values({ runId, type, message, data })
    .returning();
  if (!event) throw new Error("Failed to append run event");
  return event;
}

export async function listRunEvents(runId: string, afterId = 0): Promise<RunEvent[]> {
  return db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.id, afterId)))
    .orderBy(asc(runEvents.id));
}

export async function uploadedImageCount(runId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(referenceImages)
    .where(eq(referenceImages.runId, runId));
  return row?.value ?? 0;
}

export async function statusPayload(runId: string) {
  const run = await requireRun(runId);
  const latestSkill = await getArtifact({ runId, type: "skill" });
  return {
    id: run.id,
    status: run.status,
    currentStep: run.currentStep,
    errorMessage: run.errorMessage,
    progressPercent: computeProgress(run),
    counts: {
      images: run.imageCount,
      rawAnalyses: run.rawAnalysisCount,
      rawAnalysisTotal: run.analysisTotal,
      synthesizedNotes: run.synthesizedNoteCount,
      ruleChunks: run.ruleChunkCount,
      ruleChunkTotal: run.ruleChunkTotal,
    },
    artifacts: {
      skillReady: Boolean(latestSkill),
    },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
  };
}

function computeProgress(run: Run): number {
  if (run.status === "complete") return 100;
  if (run.status === "failed" || run.status === "canceled") return run.progressPercent;
  const analysis = run.analysisTotal > 0 ? run.rawAnalysisCount / run.analysisTotal : 0;
  const notes = run.imageCount > 0 ? run.synthesizedNoteCount / run.imageCount : 0;
  const chunks = run.ruleChunkTotal > 0 ? run.ruleChunkCount / run.ruleChunkTotal : 0;
  const value = Math.round(5 + analysis * 45 + notes * 30 + chunks * 10);
  return Math.max(run.progressPercent, Math.min(value, 95));
}

export async function nullImageIds(runId: string) {
  return db
    .select()
    .from(referenceImages)
    .where(and(eq(referenceImages.runId, runId), isNull(referenceImages.imageId)));
}
