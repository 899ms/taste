import {
  analyzeImage as runImageAnalysis,
  chunkSynthesizedNotes,
  extractRuleChunk,
  generateSkill as generateSkillArtifact,
  modelSlug,
  synthesizeImageNote,
  synthesizeRuleSet,
  type RuleChunkResult,
} from "@taste/ai";

import { analysisModels, env } from "@/config";
import {
  appendRunEvent,
  claimStatus,
  countArtifacts,
  decryptRunToken,
  failRun,
  getArtifact,
  getImageByImageId,
  listActiveImages,
  listArtifacts,
  listImages,
  purgeRunToken,
  requireRun,
  setRawAnalysisCount,
  setRuleChunkCount,
  setRuleChunkTotal,
  setRunIndexed,
  setSynthesizedNoteCount,
  storeArtifact,
  updateImageIndex,
  updateRunStatus,
} from "@/db/repository";
import { downloadBlobBytes, putTextArtifact } from "@/storage/blob";
import { dimensions, sha256 } from "@/storage/image";

const analyzeConcurrency = Number(process.env.ANALYZE_IMAGE_CONCURRENCY ?? "8");
const synthesizeConcurrency = Number(process.env.SYNTHESIZE_NOTE_CONCURRENCY ?? "8");

export async function processRun(runId: string) {
  try {
    const initialRun = await requireRun(runId);
    if (initialRun.status === "complete" || initialRun.status === "canceled") return;
    if (initialRun.status === "uploading") {
      throw new Error("Run has not been queued");
    }
    if (initialRun.status === "generating_skill") {
      await generateFinalSkill(runId, decryptRunToken(initialRun) || undefined);
      return;
    }
    if (initialRun.status === "extracting_rules") {
      await extractRulesAndSkill(runId);
      return;
    }

    await updateRunStatus(runId, "indexing", {
      currentStep: "Indexing uploaded reference images",
      progressPercent: 2,
    });
    await appendRunEvent(runId, "run.indexing", "Indexing uploaded reference images");

    const activeImages = await indexImages(runId);
    const models = analysisModels();
    await setRunIndexed({
      runId,
      imageCount: activeImages.length,
      analysisTotal: activeImages.length * models.length,
    });
    await appendRunEvent(
      runId,
      "run.analyzing",
      `Analyzing ${activeImages.length} images with ${models.length} models`,
    );

    await mapConcurrent(activeImages, analyzeConcurrency, async (image) => {
      if (!image.imageId) return;
      await analyzeOneImage(runId, image.imageId);
    });

    await mapConcurrent(activeImages, synthesizeConcurrency, async (image) => {
      if (!image.imageId) return;
      await synthesizeOneNote(runId, image.imageId);
    });

    const claimed = await claimStatus(
      runId,
      "synthesizing_notes",
      "extracting_rules",
      "Extracting visual rule chunks",
    );
    if (!claimed) {
      const run = await requireRun(runId);
      if (run.status !== "extracting_rules") return;
    }
    await extractRulesAndSkill(runId);
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

async function indexImages(runId: string) {
  const uploaded = await listImages(runId);
  if (uploaded.length === 0) throw new Error("No uploaded images found");
  const seen = new Map<string, string>();
  let activeIndex = 0;

  for (const image of uploaded) {
    const bytes = await downloadBlobBytes(image.downloadUrl ?? image.blobUrl);
    const digest = sha256(bytes);
    const size = dimensions(bytes);
    const duplicateOfImageId = seen.get(digest) ?? null;
    const imageId = duplicateOfImageId
      ? null
      : `img_${String(++activeIndex).padStart(4, "0")}`;
    if (imageId) seen.set(digest, imageId);
    await updateImageIndex({
      rowId: image.id,
      imageId,
      sha256: digest,
      width: size.width,
      height: size.height,
      isDuplicate: Boolean(duplicateOfImageId),
      duplicateOfImageId,
    });
  }

  const active = await listActiveImages(runId);
  const rows = active.map((image) =>
    JSON.stringify({
      id: image.imageId,
      path: image.pathname,
      basename: image.basename,
      sha256: image.sha256,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      createdAt: image.createdAt.toISOString(),
    }),
  );
  const content = `${rows.join("\n")}${rows.length ? "\n" : ""}`;
  const stored = await putTextArtifact(`runs/${runId}/01-corpus/images.jsonl`, content);
  await storeArtifact({
    runId,
    type: "corpus_index",
    pathname: stored.pathname,
    blobUrl: stored.blobUrl,
    content,
    bytes: stored.bytes,
  });
  return active;
}

async function analyzeOneImage(runId: string, imageId: string) {
  const run = await requireRun(runId);
  const image = await getImageByImageId(runId, imageId);
  const imageBytes = await downloadBlobBytes(image.downloadUrl ?? image.blobUrl);
  const token = decryptRunToken(run);
  const models = analysisModels();
  const results = await Promise.all(
    models.map(async (model) => ({
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

  for (const { model, result } of results) {
    const content = withFrontmatter(
      {
        imageId,
        image: image.pathname,
        model,
        proxyProvider: providerFromModel(model),
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
      },
    });
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
  const rawAnalyses = (await listArtifacts(runId, "raw_analysis")).filter(
    (artifact) => artifact.imageId === imageId,
  );
  const expected = analysisModels().length;
  if (rawAnalyses.length < expected) {
    throw new Error(`Missing raw analyses for ${imageId}: ${rawAnalyses.length}/${expected}`);
  }
  const result = await synthesizeImageNote({
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
    analyses: rawAnalyses.map((artifact) => ({
      model: artifact.model ?? "unknown",
      text: artifact.content ?? "",
    })),
  });

  const content = withFrontmatter(
    {
      imageId,
      image: image.pathname,
      sourceAnalyses: rawAnalyses.map((artifact) => artifact.model ?? "unknown"),
      synthesisModel: env().SYNTHESIS_MODEL,
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
    },
  });
  await setSynthesizedNoteCount(runId, await countArtifacts(runId, "synthesized_note"));
  await appendRunEvent(runId, "image.synthesized", `Synthesized ${imageId}`, { imageId });
}

async function extractRulesAndSkill(runId: string) {
  const run = await requireRun(runId);
  const notes = (await listArtifacts(runId, "synthesized_note")).map((artifact) => ({
    imageId: artifact.imageId ?? "",
    file: `${artifact.imageId}.md`,
    text: artifact.content ?? "",
  }));
  const chunks = chunkSynthesizedNotes(notes, env().RULE_CHUNK_SIZE);
  await setRuleChunkTotal(runId, chunks.length);
  await appendRunEvent(runId, "rules.chunking", `Extracting ${chunks.length} rule chunks`);
  const token = decryptRunToken(run) || undefined;

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      const result = await extractRuleChunk({
        aiGatewayToken: token,
        model: env().RULE_MODEL,
        chunk,
      });
      const stored = await putTextArtifact(
        `runs/${runId}/03-rule-set/chunks/${chunk.id}-rules.md`,
        result.text,
      );
      await storeArtifact({
        runId,
        type: "rule_chunk",
        chunkId: chunk.id,
        model: env().RULE_MODEL,
        pathname: stored.pathname,
        blobUrl: stored.blobUrl,
        content: result.text,
        bytes: stored.bytes,
        metadata: {
          usage: result.usage,
          responseModel: result.model,
          files: chunk.notes.map((note) => note.file),
        },
      });
      await setRuleChunkCount(runId, await countArtifacts(runId, "rule_chunk"));
      await appendRunEvent(runId, "rules.chunk.complete", `Completed ${chunk.id}`, {
        chunkId: chunk.id,
      });
      return {
        id: chunk.id,
        files: chunk.notes.map((note) => note.file),
        text: result.text,
      } satisfies RuleChunkResult;
    }),
  );

  const ruleSet = await synthesizeRuleSet({
    aiGatewayToken: token,
    model: env().RULE_MODEL,
    chunkResults: chunkResults.sort((a, b) => a.id.localeCompare(b.id)),
  });
  const ruleStored = await putTextArtifact(`runs/${runId}/03-rule-set/rule-set.md`, ruleSet.text);
  await storeArtifact({
    runId,
    type: "rule_set",
    model: env().RULE_MODEL,
    pathname: ruleStored.pathname,
    blobUrl: ruleStored.blobUrl,
    content: ruleSet.text,
    bytes: ruleStored.bytes,
    metadata: {
      usage: ruleSet.usage,
      responseModel: ruleSet.model,
    },
  });
  await updateRunStatus(runId, "generating_skill", {
    currentStep: "Generating final skill",
    progressPercent: 95,
  });
  await appendRunEvent(runId, "rules.complete", "Final rule set generated");

  await generateFinalSkill(runId, token);
}

async function generateFinalSkill(runId: string, aiGatewayToken?: string | undefined) {
  const latestRuleSet = await getArtifact({ runId, type: "rule_set" });
  if (!latestRuleSet?.content) throw new Error("Final rule set is missing");
  const skill = await generateSkillArtifact({
    aiGatewayToken,
    model: env().SKILL_MODEL,
    ruleSet: latestRuleSet.content,
  });
  const skillStored = await putTextArtifact(`runs/${runId}/04-skill/SKILL.md`, skill.text);
  await storeArtifact({
    runId,
    type: "skill",
    model: env().SKILL_MODEL,
    pathname: skillStored.pathname,
    blobUrl: skillStored.blobUrl,
    content: skill.text,
    bytes: skillStored.bytes,
    metadata: {
      usage: skill.usage,
      responseModel: skill.model,
    },
  });
  await updateRunStatus(runId, "complete", {
    currentStep: "Complete",
    progressPercent: 100,
    completedAt: new Date(),
  });
  await appendRunEvent(runId, "run.complete", "Final skill generated");
  await purgeRunToken(runId);
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  const limit = Math.max(1, Math.min(items.length, concurrency));
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item !== undefined) await worker(item);
      }
    }),
  );
}

function providerFromModel(model: string): string {
  if (model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("openai/")) return "openai";
  return model.split("/")[0] ?? "gateway";
}

function withFrontmatter(metadata: Record<string, unknown>, body: string): string {
  return [
    "---",
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}
