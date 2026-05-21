#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_MODELS = ["openai/gpt-5.5", "anthropic/claude-opus-4-7"];
const args = process.argv.slice(2);
const count = readFlag("--count") ? Number(readFlag("--count")) : undefined;
const indexPath = path.resolve(readFlag("--index") ?? "taste/01-corpus/images.jsonl");
const outRoot = path.resolve(readFlag("--out") ?? "taste/02-image-notes/raw");
const models = (readFlag("--models")?.split(",").map((m) => m.trim()).filter(Boolean)) ?? DEFAULT_MODELS;
const token = process.env.SHOPIFY_AI_TOKEN;

if (!token) {
  console.error("Missing SHOPIFY_AI_TOKEN. Export your Shopify AI proxy bearer token, then rerun.");
  process.exit(1);
}

async function main() {
  const allImages = await readJsonl(indexPath);
  const images = count ? allImages.slice(0, count) : allImages;
  if (images.length === 0) throw new Error(`No images found in ${indexPath}`);

  const tasks = images.flatMap((image) => models.map((model) => ({ image, model })));
  const concurrency = Number(readFlag("--concurrency") ?? String(tasks.length));
  let completed = 0;
  console.log(`Analyzing ${images.length} image(s) with ${models.length} model(s) through Shopify AI proxy`);
  console.log(`Running ${tasks.length} request(s) with concurrency=${concurrency}`);

  await mapConcurrent(tasks, concurrency, async ({ image, model }) => {
    const outDir = path.join(outRoot, image.id);
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug(model)}.md`);
    const errPath = path.join(outDir, `${slug(model)}.error.json`);
    console.log(`→ [${completed + 1}/${tasks.length}] ${image.id} ${image.basename} with ${model}`);

    try {
      const result = await runVisionViaProxy({ model, imagePath: image.path, prompt: buildPrompt(image) });
      const header = [
        "---",
        `imageId: ${image.id}`,
        `image: ${JSON.stringify(image.path)}`,
        `model: ${model}`,
        `proxyProvider: ${providerForModel(model)}`,
        `createdAt: ${new Date().toISOString()}`,
        "---",
        "",
      ].join("\n");
      await writeFile(outPath, header + result.trim() + "\n", "utf8");
      completed += 1;
      console.log(`✓ [${completed}/${tasks.length}] wrote ${outPath}`);
    } catch (error) {
      const payload = error instanceof ProxyError ? error.payload : { message: error instanceof Error ? error.message : String(error) };
      await writeFile(errPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
      completed += 1;
      console.warn(`✗ [${completed}/${tasks.length}] failed; see ${errPath}`);
    }
  });
}

async function readJsonl(file) {
  const raw = await readFile(file, "utf8");
  return raw.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

async function runVisionViaProxy({ model, imagePath, prompt }) {
  const provider = providerForModel(model);
  const image = await imageAsData(imagePath);
  if (provider === "anthropic") return callAnthropic({ model, image, prompt });
  if (provider === "openai") return callOpenAI({ model, image, prompt });
  throw new Error(`Unsupported model/provider: ${model}`);
}

function providerForModel(model) {
  if (model.startsWith("anthropic/") || model.startsWith("anthropic:")) return "anthropic";
  if (model.startsWith("openai/") || model.startsWith("gpt-") || model.startsWith("o")) return "openai";
  return "openai";
}

function proxyModelName(model) {
  if (model.startsWith("anthropic/")) return `anthropic:${model.slice("anthropic/".length)}`;
  if (model.startsWith("openai/")) return model.slice("openai/".length);
  return model;
}

async function imageAsData(file) {
  const proxyImagePath = await prepareProxyImage(file);
  const bytes = await readFile(proxyImagePath);
  return {
    base64: bytes.toString("base64"),
    mediaType: "image/jpeg",
  };
}

async function prepareProxyImage(file) {
  const cacheDir = path.resolve("taste/cache/proxy-images");
  await mkdir(cacheDir, { recursive: true });
  const parsed = path.parse(file);
  const outPath = path.join(cacheDir, `${slug(parsed.name)}-max2000.jpg`);
  try {
    const [src, out] = await Promise.all([stat(file), stat(outPath)]);
    if (out.mtimeMs >= src.mtimeMs && out.size > 0) return outPath;
  } catch {
    // Need to create cache file.
  }
  await execFileAsync("sips", ["-Z", "2000", "-s", "format", "jpeg", file, "--out", outPath], { timeout: 30_000 });
  return outPath;
}

function mediaTypeForPath(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function callAnthropic({ model, image, prompt }) {
  const response = await fetch("https://proxy.shopify.ai/apis/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: proxyModelName(model),
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
        ],
      }],
    }),
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) throw new ProxyError(data);
  return (data.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
}

async function callOpenAI({ model, image, prompt }) {
  const response = await fetch("https://proxy.shopify.ai/vendors/openai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: proxyModelName(model),
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
  if (!response.ok) throw new ProxyError(data);
  if (typeof data.output_text === "string") return data.output_text;
  const output = data.output ?? [];
  const texts = [];
  for (const item of output) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      else if (typeof part?.text === "string") texts.push(part.text);
    }
  }
  return texts.join("\n\n");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { status: response.status, raw: text };
  }
}

class ProxyError extends Error {
  constructor(payload) {
    super(payload?.error?.message ?? payload?.message ?? "Proxy request failed");
    this.payload = payload;
  }
}

function buildPrompt(image) {
  return `You are analyzing one UI/interface design screenshot as part of a design taste corpus. The image is a verified, human-curated example of good visual design. Your task is to extract the aesthetic DNA, not explain the product.

Be specific and visual. Do not give generic praise. Do not merely list visible UI elements.

CRITICAL FOCUS: This analysis is about aesthetics and taste only: style, layout, hierarchy, color, shadows, materials, spacing, composition, density, rhythm, visual tension, polish, restraint, and vibe. The screen's domain, scenario, copy, app category, user names, depicted objects, and functional workflow are not the target. Treat them as incidental raw material unless they reveal a broader aesthetic move.

Do not create principles like "make it hospitable," "concierge-like," "guest-focused," "travel-oriented," or anything tied to the subject matter. Instead translate what you see into domain-independent visual principles such as "large centered identity mass above quiet modular cards," "single semantic accent against a monochrome field," "soft depth without borders," or "image warmth carries color while UI chrome stays neutral."

Extract transferable aesthetic principles that could guide an unrelated interface in the same taste.

Image metadata:
- id: ${image.id}
- filename: ${image.basename}
- dimensions: ${image.width}x${image.height}

Write a deep analysis with these sections:

# ${image.id} — ${image.basename}

## 1. Visual composition only
Briefly describe the visual arrangement, major shapes, alignment, surfaces, and focal points. Keep functional/domain description minimal.

## 2. What makes the aesthetic strong
Identify the strongest visual qualities and why they work as design/taste moves, independent of the screen's subject matter.

## 3. Layout and composition principles
Discuss grid, alignment, framing, hierarchy, grouping, density, whitespace, and visual rhythm.

## 4. Typography principles
Discuss scale, weight, contrast, text density, labels, headings, and how type creates hierarchy.

## 5. Color, material, light, and depth principles
Discuss palette, contrast, gradients, shadows, borders, surfaces, translucency, and restraint.

## 6. Aesthetic mood / vibe
Describe the visual vibe using domain-independent aesthetic language. Avoid product/domain interpretations.

## 7. Transferable aesthetic principles
List 10-18 principles that could guide unrelated interface designs in the same taste. Phrase these as reusable visual design rules, not observations and not domain/content advice.

## 8. What to ignore as incidental
List content, copy, subject matter, domain, depicted objects, and functional details that should NOT become taste rules.

## 9. Aesthetic tags
Provide 10-20 concise, domain-independent tags.
`;
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

await main();
