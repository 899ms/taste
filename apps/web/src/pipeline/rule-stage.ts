import {
  chunkRuleResults,
  chunkSynthesizedNotes,
  extractRuleChunk,
  generateSkill as generateSkillArtifact,
  synthesizeRuleSet,
  type RuleChunkResult,
} from "@taste/ai";

import { env } from "@/config";
import {
  appendRunEvent,
  countArtifacts,
  decryptRunToken,
  getArtifact,
  listArtifacts,
  purgeRunToken,
  requireRun,
  setRuleChunkCount,
  setRuleChunkTotal,
  storeArtifact,
  updateRunStatus,
} from "@/db/repository";
import { putTextArtifact } from "@/storage/blob";

const ruleMergeFanIn = Number(process.env.RULE_MERGE_FAN_IN ?? "6");

export async function extractRulesAndSkill(runId: string) {
  const run = await requireRun(runId);
  const notes = (await listArtifacts(runId, "synthesized_note")).map((artifact) => ({
    imageId: artifact.imageId ?? "",
    file: `${artifact.imageId}.md`,
    text: artifact.content ?? "",
  }));
  const chunks = chunkSynthesizedNotes(notes, env().RULE_CHUNK_SIZE);
  await setRuleChunkTotal(runId, chunks.length);
  await appendRunEvent(
    runId,
    "rules.chunking",
    `Extracting ${chunks.length} rule chunks with max merge fan-in ${ruleMergeFanIn}`,
  );
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

  const reducedRuleResults = await reduceRuleResults({
    runId,
    token,
    chunkResults: chunkResults.sort((a, b) => a.id.localeCompare(b.id)),
  });

  const ruleSet = await synthesizeRuleSet({
    aiGatewayToken: token,
    model: env().RULE_MODEL,
    chunkResults: reducedRuleResults,
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

export async function generateFinalSkill(runId: string, aiGatewayToken?: string | undefined) {
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

async function reduceRuleResults(input: {
  runId: string;
  token: string | undefined;
  chunkResults: RuleChunkResult[];
}): Promise<RuleChunkResult[]> {
  let current = input.chunkResults;
  let level = 1;
  while (current.length > ruleMergeFanIn) {
    const groups = chunkRuleResults(current, ruleMergeFanIn);
    await appendRunEvent(
      input.runId,
      "rules.merge.layer",
      `Merging ${current.length} rule chunks into ${groups.length} intermediate chunks`,
      { level, inputCount: current.length, outputCount: groups.length },
    );
    current = await Promise.all(
      groups.map(async (group, index) => {
        const id = `merge_${String(level).padStart(2, "0")}_${String(index + 1).padStart(2, "0")}`;
        const result = await synthesizeRuleSet({
          aiGatewayToken: input.token,
          model: env().RULE_MODEL,
          chunkResults: group,
        });
        const stored = await putTextArtifact(
          `runs/${input.runId}/03-rule-set/merges/${id}-rules.md`,
          result.text,
        );
        await storeArtifact({
          runId: input.runId,
          type: "rule_merge",
          chunkId: id,
          model: env().RULE_MODEL,
          pathname: stored.pathname,
          blobUrl: stored.blobUrl,
          content: result.text,
          bytes: stored.bytes,
          metadata: {
            usage: result.usage,
            responseModel: result.model,
            sourceChunks: group.map((chunk) => chunk.id),
          },
        });
        await appendRunEvent(input.runId, "rules.merge.complete", `Completed ${id}`, {
          level,
          chunkId: id,
        });
        return {
          id,
          files: group.flatMap((chunk) => chunk.files),
          text: result.text,
        } satisfies RuleChunkResult;
      }),
    );
    level += 1;
  }
  return current.sort((a, b) => a.id.localeCompare(b.id));
}
