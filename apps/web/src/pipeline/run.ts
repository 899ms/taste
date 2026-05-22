import { analysisModels } from "@/config";
import {
  appendRunEvent,
  claimStatus,
  decryptRunToken,
  failRun,
  requireRun,
  setRunIndexed,
  updateRunStatus,
} from "@/db/repository";
import { processImageStage } from "./image-stage";
import { indexImages } from "./indexing";
import { extractRulesAndSkill, generateFinalSkill } from "./rule-stage";

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

    await processImageStage(runId, activeImages);

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
