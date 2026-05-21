#!/usr/bin/env node

import { randomInt } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const inputDir = path.resolve(readFlag("--input") ?? "taste/02-image-notes/synthesized");
const ruleOut = path.resolve(readFlag("--rule-out") ?? "taste/03-rule-set/rule-set.md");
const runId = readFlag("--run-id") ?? timestampId();
const workDir = path.resolve(readFlag("--work-dir") ?? `taste/03-rule-set/chunks/${runId}`);
const model = readFlag("--model") ?? "openai/gpt-5.5";
const chunks = Number(readFlag("--chunks") ?? "4");
const chunkSize = Number(readFlag("--chunk-size") ?? "7");
const concurrency = Number(readFlag("--concurrency") ?? String(chunks));
const token = process.env.SHOPIFY_AI_TOKEN;

if (!token) {
  console.error("Missing SHOPIFY_AI_TOKEN. Export your Shopify AI proxy bearer token, then rerun.");
  process.exit(1);
}

await main();

async function main() {
  const files = (await readdir(inputDir))
    .filter((file) => /^img_\d+\.md$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const required = chunks * chunkSize;
  if (files.length < required) {
    throw new Error(`Need at least ${required} synthesized notes for ${chunks}×${chunkSize}; found ${files.length}`);
  }

  const shuffled = shuffle([...files]).slice(0, required);
  const chunkSpecs = Array.from({ length: chunks }, (_, index) => ({
    id: `chunk_${String(index + 1).padStart(2, "0")}`,
    files: shuffled.slice(index * chunkSize, (index + 1) * chunkSize),
  }));

  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(ruleOut), { recursive: true });

  await writeFile(path.join(workDir, "manifest.json"), JSON.stringify({
    runId,
    inputDir,
    ruleOut,
    workDir,
    model,
    reasoning: "high",
    chunks,
    chunkSize,
    concurrency,
    createdAt: new Date().toISOString(),
    chunkSpecs,
  }, null, 2) + "\n", "utf8");

  console.log(`Rule-set run ${runId}`);
  console.log(`Input: ${inputDir}`);
  console.log(`Running ${chunks} random ${chunkSize}-note chunk extractions with ${model} high reasoning, concurrency=${concurrency}`);

  const chunkResults = [];
  await mapConcurrent(chunkSpecs, concurrency, async (spec) => {
    console.log(`→ ${spec.id}: ${spec.files.join(", ")}`);
    const notes = [];
    for (const file of spec.files) {
      notes.push({ file, text: await readFile(path.join(inputDir, file), "utf8") });
    }
    const text = await callOpenAIHigh({ model, prompt: buildChunkPrompt(spec, notes) });
    const out = path.join(workDir, `${spec.id}-rules.md`);
    await writeFile(out, text.trim() + "\n", "utf8");
    chunkResults.push({ ...spec, path: out, text });
    console.log(`✓ ${spec.id} wrote ${out}`);
  });

  chunkResults.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`→ synthesizing dictator visual rule set from ${chunkResults.length} chunk rule drafts`);
  const ruleSet = await callOpenAIHigh({ model, prompt: buildRuleSetPrompt(chunkResults) });
  await writeFile(ruleOut, ruleSet.trim() + "\n", "utf8");
  console.log(`✓ wrote rule set ${ruleOut}`);

}

function buildChunkPrompt(spec, notes) {
  const bundle = notes.map((note) => `\n\n<image-note file="${note.file}">\n${note.text}\n</image-note>`).join("\n");
  return `You are extracting a STRICT, concrete visual rule set from a random subset of canonical image notes.

The previous attempt failed because it over-generalized into broad mood words. Your task is to avoid that failure.

DO NOT summarize the images with vague aesthetic labels. Avoid words such as luxury, premium, editorial, tactile, sophisticated, elegant, boutique, fashion, lifestyle, atmospheric, cinematic, gallery-like, high-end, warm, tasteful, beautiful, elevated, object-like, or refined unless you are explicitly listing terms to avoid. These words trigger model stereotypes and are not useful rules.

DO extract direct production rules a model can follow without making open-ended aesthetic decisions.

A good rule is:
- observable in the image notes,
- specific enough to implement,
- transferable across domains,
- declarative, not optional,
- about visible design decisions: typography, color, shadows, radius, spacing, density, alignment, borders, surfaces, icon/detail treatment, composition.

A bad rule is:
- mood/vibe language,
- a broad principle such as "make it premium",
- an invitation for the model to choose a style,
- tied to product domain/content/copy,
- a fashion/luxury/serif/beige stereotype.

Chunk ${spec.id}
Files: ${spec.files.join(", ")}

Input notes:${bundle}

Write a chunk rule extraction with these exact sections:

# ${spec.id} Concrete Visual Rules

## Rules to keep
Write 40-70 specific, imperative rules. Be dictator-driven. Prefer "Use...", "Set...", "Avoid...", "Do not...". Do not hedge with "often" unless the source genuinely conflicts.

## Numeric / relational constraints
Where exact values are unavailable, give useful relative constraints: low saturation, one accent max, thin borders, large soft blur, generous padding, few type weights, localized density, etc.

## Prohibited model shortcuts
List concrete shortcuts the generator must not use: beige luxury fashion default, serif monogram avatar, boutique brand naming, terracotta-by-default, lifestyle product copy, fake phone frame unless asked, etc., but only include shortcuts supported by the risk in this chunk or by obvious model-prior risk.

## Source-specific content to discard
List content/domain/copy/signifier observations that should not become style rules.
`;
}

function buildRuleSetPrompt(chunkResults) {
  const drafts = chunkResults.map((result) => `\n\n<chunk-rules id="${result.id}" files="${result.files.join(",")}">\n${result.text}\n</chunk-rules>`).join("\n");
  return `You are synthesizing chunk-level rule drafts into one STRICT visual rule set for a design-generation skill.

The previous skill failed by using vague taste words that caused model-prior collapse into beige luxury editorial commerce. Do not repeat that mistake.

You must produce a concrete, declarative, specific, somewhat long rule set. It is okay if it is longer than a typical skill. Specificity is the goal. Do not leave aesthetic choices open for the generator when the reference taste can constrain them.

BANNED AS STYLE GUIDANCE:
Do not use broad labels such as luxury, premium, editorial, tactile, sophisticated, elegant, boutique, fashion, lifestyle, atmospheric, cinematic, gallery-like, high-end, warm, tasteful, beautiful, elevated, object-like, refined, crafted, polished. You may use these only in the anti-pattern section as words/signifiers to avoid relying on.

REQUIRED BEHAVIOR:
- Convert every abstract finding into a visible production constraint.
- Default to concrete choices: neutral sans typography, restrained color, soft shadows, minimal borders, rounded geometry, clear spacing, localized density.
- Forbid stereotype shortcuts: beige luxury commerce, serif display names by default, monogram avatars, boutique brand copy, terracotta as default accent, fake device frames unless requested, fashion/homeware content as aesthetic proxy.
- Keep the design language domain-agnostic. The aesthetic must come from visible structure, not invented content.
- Do not include image IDs, chunk IDs, evidence references, or process notes in the final rule set.
- Make compatible exceptions explicit and bounded; do not leave broad freedom.

Chunk rule drafts:${drafts}

Write the final rule set with this exact structure:

# Taste Rule Set

## 1. Purpose
A short explanation that this is a concrete visual production rule set, not a mood board.

## 2. Non-negotiable defaults
15-25 top-level defaults the generator should follow unless the user explicitly asks otherwise.

## 3. Typography rules
Specific rules for sans-serif defaults, weights, scale, spacing, labels, hierarchy, avoiding serif/luxury-wordmark defaults, etc.

## 4. Color rules
Specific rules for neutral palettes, saturation, accent count/size, avoiding beige/terracotta/fashion palettes by default, dark mode constraints.

## 5. Surface, shadow, and border rules
Specific rules for shadows, radius, fills, value separation, line weight, avoiding glossy/harsh/heavy effects.

## 6. Layout, spacing, and density rules
Specific rules for whitespace, grouping, composition, alignment, responsive layouts, localized density, avoiding generic equal-card grids.

## 7. Detail and component treatment
Specific rules for icons, pills, chips, active states, data rows, cards, avatars, product thumbnails, navigation, status marks.

## 8. Content neutrality rules
Specific rules preventing generated names, brand copy, item categories, avatars, or app brands from carrying the aesthetic.

## 9. Anti-patterns and banned shortcuts
A direct blacklist of visual/content shortcuts that caused or could cause collapse.

## 10. Final generation checklist
A concrete checklist the generator must pass before finishing.
`;
}

async function callOpenAIHigh({ model, prompt }) {
  const response = await fetch("https://proxy.shopify.ai/vendors/openai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: model.startsWith("openai/") ? model.slice("openai/".length) : model,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      reasoning: { effort: "high" },
      max_output_tokens: 20000,
    }),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(JSON.stringify(data, null, 2));
  if (typeof data.output_text === "string") return data.output_text;
  const texts = [];
  for (const item of data.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      else if (typeof part?.text === "string") texts.push(part.text);
    }
  }
  return texts.join("\n\n");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { status: response.status, raw: text }; }
}

async function mapConcurrent(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(items.length, Number.isFinite(concurrency) ? concurrency : items.length));
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  }));
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
