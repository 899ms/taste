import {
  analyzeImage as runImageAnalysis,
  modelSlug,
  synthesizeImageNote,
} from "@taste/ai";

import { analysisModels, env } from "@/config";
import {
  appendRunEvent,
  countArtifacts,
  decryptRunToken,
  getArtifact,
  getImageByImageId,
  listArtifacts,
  requireRun,
  setRawAnalysisCount,
  setSynthesizedNoteCount,
  storeArtifact,
} from "@/db/repository";
import type { ReferenceImage } from "@/db/schema";
import { downloadBlobBytes, putTextArtifact } from "@/storage/blob";
import {
  AdaptiveLimiter,
  errorMessage,
  mapConcurrent,
  providerFromModel,
  softFailedGenerationResult,
  withFrontmatter,
} from "./utils";

const analyzeConcurrency = Number(process.env.ANALYZE_IMAGE_CONCURRENCY ?? "8");
const synthesizeConcurrency = Number(process.env.SYNTHESIZE_NOTE_CONCURRENCY ?? "8");

export async function processImageStage(runId: string, activeImages: ReferenceImage[]) {
  const synthLimiter = new AdaptiveLimiter(synthesizeConcurrency);
  const synthesisJobs: Promise<void>[] = [];

  await mapConcurrent(activeImages, analyzeConcurrency, async (image) => {
    if (!image.imageId) return;
    await analyzeOneImage(runId, image.imageId);
    synthesisJobs.push(synthLimiter.run(() => synthesizeOneNote(runId, image.imageId ?? "")));
  });

  await Promise.all(synthesisJobs);
}

async function analyzeOneImage(runId: string, imageId: string) {
  const run = await requireRun(runId);
  const image = await getImageByImageId(runId, imageId);
  const imageBytes = await downloadBlobBytes(image.downloadUrl ?? image.blobUrl);
  const token = decryptRunToken(run);
  const models = analysisModels();
  const existing = (await listArtifacts(runId, "raw_analysis")).filter(
    (artifact) => artifact.imageId === imageId,
  );
  const existingModels = new Set(existing.map((artifact) => artifact.model));
  const missingModels = models.filter((model) => !existingModels.has(model));
  if (missingModels.length === 0) {
    await setRawAnalysisCount(runId, await countArtifacts(runId, "raw_analysis"));
    return;
  }

  const results = await Promise.allSettled(
    missingModels.map(async (model) => ({
      model,
      result: await runImageAnalysis({
        aiGatewayToken: token || undefined,
        model,
        image: {
          id: image.imageId ?? imageId,
          basename: image.basename,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
        },
        imageInput: {
          bytes: imageBytes,
          mediaType: image.contentType,
        },
      }),
    })),
  );

  for (const [index, resultItem] of results.entries()) {
    const model =
      resultItem.status === "fulfilled"
        ? resultItem.value.model
        : missingModels[index] ?? "unknown";
    const result =
      resultItem.status === "fulfilled"
        ? resultItem.value.result
        : softFailedGenerationResult(
            `Raw analysis failed after retries for ${imageId} with ${model}.`,
            resultItem.reason,
          );
    const content = withFrontmatter(
      {
        imageId,
        image: image.pathname,
        model,
        proxyProvider: providerFromModel(model),
        softFailed: resultItem.status === "rejected",
        createdAt: new Date().toISOString(),
      },
      result.text,
    );
    const stored = await putTextArtifact(
      `runs/${runId}/02-image-notes/raw/${imageId}/${modelSlug(model)}.md`,
      content,
    );
    await storeArtifact({
      runId,
      type: "raw_analysis",
      imageId,
      model,
      pathname: stored.pathname,
      blobUrl: stored.blobUrl,
      content,
      bytes: stored.bytes,
      metadata: {
        usage: result.usage,
        responseModel: result.model,
        softFailed: resultItem.status === "rejected",
        error: resultItem.status === "rejected" ? errorMessage(resultItem.reason) : undefined,
      },
    });
    if (resultItem.status === "rejected") {
      await appendRunEvent(runId, "image.analysis.soft_failed", `Soft-failed ${imageId} ${model}`, {
        imageId,
        model,
        error: errorMessage(resultItem.reason),
      });
    }
  }
  await setRawAnalysisCount(runId, await countArtifacts(runId, "raw_analysis"));
  await appendRunEvent(runId, "image.analyzed", `Analyzed ${imageId}`, {
    imageId,
    models,
  });
}

async function synthesizeOneNote(runId: string, imageId: string) {
  const run = await requireRun(runId);
  const image = await getImageByImageId(runId, imageId);
  const imageBytes = await downloadBlobBytes(image.downloadUrl ?? image.blobUrl);
  const existing = await getArtifact({ runId, type: "synthesized_note", imageId });
  if (existing) {
    await setSynthesizedNoteCount(runId, await countArtifacts(runId, "synthesized_note"));
    return;
  }
  const rawAnalyses = (await listArtifacts(runId, "raw_analysis")).filter(
    (artifact) => artifact.imageId === imageId,
  );
  const expected = analysisModels().length;
  if (rawAnalyses.length < expected) {
    throw new Error(`Missing raw analyses for ${imageId}: ${rawAnalyses.length}/${expected}`);
  }

  const analyses = rawAnalyses.map((artifact) => ({
    model: artifact.model ?? "unknown",
    text: artifact.content ?? "",
  }));
  let softFailed = false;
  let result;
  try {
    result = await synthesizeImageNote({
      aiGatewayToken: decryptRunToken(run) || undefined,
      model: env().SYNTHESIS_MODEL,
      image: {
        id: image.imageId ?? imageId,
        basename: image.basename,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
      },
      imageInput: {
        bytes: imageBytes,
        mediaType: image.contentType,
      },
      analyses,
    });
  } catch (error) {
    softFailed = true;
    result = softFailedGenerationResult(
      `Image synthesis failed after retries for ${imageId}. Preserve the run by carrying raw evidence forward.`,
      error,
      analyses.map((analysis) => analysis.text).join("\n\n---\n\n"),
    );
    await appendRunEvent(runId, "image.synthesis.soft_failed", `Soft-failed synthesis for ${imageId}`, {
      imageId,
      error: errorMessage(error),
    });
  }

  const content = withFrontmatter(
    {
      imageId,
      image: image.pathname,
      sourceAnalyses: rawAnalyses.map((artifact) => artifact.model ?? "unknown"),
      synthesisModel: env().SYNTHESIS_MODEL,
      softFailed,
      createdAt: new Date().toISOString(),
    },
    result.text,
  );
  const stored = await putTextArtifact(
    `runs/${runId}/02-image-notes/synthesized/${imageId}.md`,
    content,
  );
  await storeArtifact({
    runId,
    type: "synthesized_note",
    imageId,
    model: env().SYNTHESIS_MODEL,
    pathname: stored.pathname,
    blobUrl: stored.blobUrl,
    content,
    bytes: stored.bytes,
    metadata: {
      usage: result.usage,
      responseModel: result.model,
      softFailed,
    },
  });
  await setSynthesizedNoteCount(runId, await countArtifacts(runId, "synthesized_note"));
  await appendRunEvent(runId, "image.synthesized", `Synthesized ${imageId}`, { imageId });
}
