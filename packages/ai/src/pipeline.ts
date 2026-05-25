import {
  buildSkillFrontmatter,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_SKILL_DESCRIPTION,
  normalizeSkillDescription,
  normalizeSkillName,
} from "./config";
import {
  buildAnalysisPrompt,
  buildChunkPrompt,
  buildRuleSetPrompt,
  buildSkillPrompt,
  buildSynthesisPrompt,
} from "./prompts";
import { generateProviderText, generateProviderVisionText } from "./providers";
import type {
  AiProviderCredentials,
  ChunkSpec,
  RawAnalysisInput,
  RuleChunkResult,
  SynthesizeImageNoteInput,
  TextGenerationResult,
} from "./types";

export async function analyzeImage(
  input: RawAnalysisInput,
): Promise<TextGenerationResult> {
  return generateProviderVisionText({
    credentials: input.credentials,
    model: input.model,
    prompt: buildAnalysisPrompt(input.image),
    image: input.imageInput,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS.analysis,
    abortSignal: input.abortSignal,
  });
}

export async function synthesizeImageNote(
  input: SynthesizeImageNoteInput,
): Promise<TextGenerationResult> {
  return generateProviderVisionText({
    credentials: input.credentials,
    model: input.model,
    prompt: buildSynthesisPrompt({
      image: input.image,
      analyses: input.analyses,
    }),
    image: input.imageInput,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS.synthesizedNote,
    abortSignal: input.abortSignal,
  });
}

export async function extractRuleChunk(input: {
  credentials?: AiProviderCredentials | undefined;
  model: string;
  chunk: ChunkSpec;
  abortSignal?: AbortSignal | undefined;
}): Promise<TextGenerationResult> {
  return generateProviderText({
    credentials: input.credentials,
    model: input.model,
    prompt: buildChunkPrompt(input.chunk),
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS.ruleChunk,
    abortSignal: input.abortSignal,
  });
}

export async function synthesizeRuleSet(input: {
  credentials?: AiProviderCredentials | undefined;
  model: string;
  chunkResults: RuleChunkResult[];
  abortSignal?: AbortSignal | undefined;
}): Promise<TextGenerationResult> {
  return generateProviderText({
    credentials: input.credentials,
    model: input.model,
    prompt: buildRuleSetPrompt(input.chunkResults),
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS.ruleSet,
    abortSignal: input.abortSignal,
  });
}

export async function generateSkill(input: {
  credentials?: AiProviderCredentials | undefined;
  model: string;
  ruleSet: string;
  skillName?: string | null | undefined;
  abortSignal?: AbortSignal | undefined;
}): Promise<TextGenerationResult> {
  const skillName = normalizeSkillName(input.skillName);
  const result = await generateProviderText({
    credentials: input.credentials,
    model: input.model,
    prompt: buildSkillPrompt(input.ruleSet, skillName),
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS.skill,
    abortSignal: input.abortSignal,
  });
  const parsed = parseSkillGenerationOutput(result.text);
  return {
    ...result,
    text: `${buildSkillFrontmatter({
      skillName,
      description: parsed.description,
    })}${parsed.body}`,
  };
}

export function parseSkillGenerationOutput(markdown: string): {
  description: string;
  body: string;
  usedFallbackDescription: boolean;
} {
  const text = stripFrontmatter(markdown.trim());
  const description = normalizeSkillDescription(extractTaggedBlock(text, "skill-description"));
  const bodyBlock = extractTaggedBlock(text, "skill-body");
  const bodySource = bodyBlock ?? removeTaggedBlock(text, "skill-description");
  const body = stripFrontmatter(bodySource)
    .replace(/^<skill-body>\s*/i, "")
    .replace(/\s*<\/skill-body>\s*$/i, "")
    .trim();

  return {
    description: description ?? DEFAULT_SKILL_DESCRIPTION,
    body,
    usedFallbackDescription: description === null,
  };
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
}

function extractTaggedBlock(markdown: string, tag: string): string | null {
  const match = markdown.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function removeTaggedBlock(markdown: string, tag: string): string {
  return markdown.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi"), "").trim();
}
