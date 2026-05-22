#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const count = readFlag("--count") ? Number(readFlag("--count")) : undefined;
const indexPath = path.resolve(readFlag("--index") ?? "pipeline/taste/01-corpus/images.jsonl");
const perImageRoot = path.resolve(readFlag("--per-image") ?? "pipeline/taste/02-image-notes/raw");
const outRoot = path.resolve(readFlag("--out") ?? "pipeline/taste/02-image-notes/synthesized");
const synthModel = readFlag("--model") ?? "openai/gpt-5.5";
const token = process.env.SHOPIFY_AI_TOKEN;

if (!token) {
  console.error("Missing SHOPIFY_AI_TOKEN. Export your Shopify AI proxy bearer token, then rerun.");
  process.exit(1);
}

await main();

async function main() {
  const allImages = await readJsonl(indexPath);
  const images = count ? allImages.slice(0, count) : allImages;
  const concurrency = Number(readFlag("--concurrency") ?? String(images.length));
  let completed = 0;
  await mkdir(outRoot, { recursive: true });
  console.log(`Synthesizing ${images.length} image(s) with concurrency=${concurrency}`);

  await mapConcurrent(images, concurrency, async (image) => {
    const dir = path.join(perImageRoot, image.id);
    const openai = await readOptional(path.join(dir, "openai_gpt-5.5.md"));
    const anthropic = await readOptional(path.join(dir, "anthropic_claude-opus-4-7.md"));
    if (!openai || !anthropic) {
      completed += 1;
      console.warn(`Skipping [${completed}/${images.length}] ${image.id}: missing one or both model analyses`);
      return;
    }
    console.log(`→ [${completed + 1}/${images.length}] synthesizing ${image.id} ${image.basename}`);
    const outPath = path.join(outRoot, `${image.id}.md`);
    const errPath = path.join(outRoot, `${image.id}.error.json`);
    try {
      const master = await callOpenAIResponsesWithImage({
        model: synthModel,
        imagePath: image.path,
        prompt: buildSynthesisPrompt({ image, openai, anthropic }),
      });
      const header = [
        "---",
        `imageId: ${image.id}`,
        `image: ${JSON.stringify(image.path)}`,
        `sourceAnalyses:` ,
        `  - openai/gpt-5.5`,
        `  - anthropic/claude-opus-4-7`,
        `synthesisModel: ${synthModel}`,
        `createdAt: ${new Date().toISOString()}`,
        "---",
        "",
      ].join("\n");
      await writeFile(outPath, header + master.trim() + "\n", "utf8");
      completed += 1;
      console.log(`✓ [${completed}/${images.length}] wrote ${outPath}`);
    } catch (error) {
      await writeFile(errPath, JSON.stringify({ message: error instanceof Error ? error.message : String(error) }, null, 2) + "\n", "utf8");
      completed += 1;
      console.warn(`✗ [${completed}/${images.length}] failed; see ${errPath}`);
    }
  });
}

async function readJsonl(file) {
  const raw = await readFile(file, "utf8");
  return raw.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

async function readOptional(file) {
  try { return await readFile(file, "utf8"); } catch { return undefined; }
}

function buildSynthesisPrompt({ image, openai, anthropic }) {
  return `You are rectifying two independent visual analyses of the same UI screenshot into one canonical master vision note for a design taste corpus. The screenshot is a verified, human-curated example of good visual design. Your job is to extract aesthetic DNA, not product meaning.

This master note is about aesthetics and taste only: style, layout, hierarchy, color, shadows, materials, spacing, composition, density, rhythm, visual tension, polish, restraint, and vibe. The screen's domain, scenario, copy, app category, user names, depicted objects, and functional workflow are not the target. Treat them as incidental raw material unless they reveal a broader aesthetic move.

Do not preserve conclusions like "concierge," "hospitable," "guest-focused," "travel-oriented," or other domain/subject-matter interpretations. Translate those into domain-independent visual ideas: quiet generosity, centered hero mass, restrained semantic accent, soft modular surfaces, tactile counterpoint, calm density, etc.

Look at the image again. Use the two analyses as evidence, but correct anything that seems too functional, content-specific, overstated, brand-specific, or not actually visible. Preserve sharp aesthetic insights. Remove duplication. The output should become the definitive per-image taste note for later cross-image synthesis.

Image metadata:
- id: ${image.id}
- filename: ${image.basename}
- dimensions: ${image.width}x${image.height}

Analysis A:
---
${openai}
---

Analysis B:
---
${anthropic}
---

Write the master note with this structure:

# ${image.id} — ${image.basename} Master Vision

## 1. Visual summary
A concise but specific description of the visual composition only: shapes, alignment, hierarchy, surfaces, density, and focal points. Keep domain/function minimal.

## 2. Why this aesthetic works
The most important visual strengths and why they matter as design/taste moves, independent of the screen's subject matter.

## 3. Transferable aesthetic principles
12-18 reusable aesthetic/design principles, phrased as rules that could guide unrelated interfaces. These must be domain-independent and should not mention the screen's scenario, content, or function.

## 4. Pattern categories
Group the principles under layout/composition, typography, color/material/depth, density/spacing, aesthetic mood, and restraint/avoidance.

## 5. What is incidental or too literal
Screen content, functionality, product category, copy, depicted objects, names, scenario, or reference-specific details that should not become general taste rules.

## 6. Evidence tags
15-25 concise, domain-independent aesthetic tags that will help cluster this image with others later.
`;
}

async function callOpenAIResponsesWithImage({ model, imagePath, prompt }) {
  const image = await imageAsData(imagePath);
  const response = await fetch("https://proxy.shopify.ai/vendors/openai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: model.startsWith("openai/") ? model.slice("openai/".length) : model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${image.mediaType};base64,${image.base64}` },
        ],
      }],
      max_output_tokens: 4096,
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

async function imageAsData(file) {
  const proxyImagePath = await prepareProxyImage(file);
  const bytes = await readFile(proxyImagePath);
  return { base64: bytes.toString("base64"), mediaType: "image/jpeg" };
}

async function prepareProxyImage(file) {
  const cacheDir = path.resolve("pipeline/taste/cache/proxy-images");
  await mkdir(cacheDir, { recursive: true });
  const parsed = path.parse(file);
  const outPath = path.join(cacheDir, `${slug(parsed.name)}-max2000.jpg`);
  try {
    const [src, out] = await Promise.all([stat(file), stat(outPath)]);
    if (out.mtimeMs >= src.mtimeMs && out.size > 0) return outPath;
  } catch {}
  await execFileAsync("sips", ["-Z", "2000", "-s", "format", "jpeg", file, "--out", outPath], { timeout: 30_000 });
  return outPath;
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

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}
