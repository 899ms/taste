#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_SOURCE = "/Users/jaytel/Desktop/taste-selects";
const sourceDir = path.resolve(process.argv[2] ?? DEFAULT_SOURCE);
const outPath = path.resolve(process.argv[3] ?? "pipeline/taste/01-corpus/images.jsonl");
const supported = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

await main();

async function main() {
  const files = (await findImages(sourceDir)).sort((a, b) => naturalCompare(path.basename(a), path.basename(b)) || a.localeCompare(b));
  await mkdir(path.dirname(outPath), { recursive: true });

  const seen = new Map();
  const rows = [];
  for (const file of files) {
    const sha256 = await hashFile(file);
    if (seen.has(sha256)) {
      console.warn(`duplicate: ${file} == ${seen.get(sha256)}`);
      continue;
    }
    seen.set(sha256, file);
    const dimensions = await imageDimensions(file);
    const st = await stat(file);
    rows.push({
      id: `img_${String(rows.length + 1).padStart(4, "0")}`,
      path: file,
      basename: path.basename(file),
      sha256,
      bytes: st.size,
      width: dimensions.width,
      height: dimensions.height,
      createdAt: new Date().toISOString(),
    });
  }

  await writeFile(outPath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  console.log(`Indexed ${rows.length} image(s) from ${sourceDir}`);
  console.log(`Wrote ${outPath}`);
}

async function findImages(dir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findImages(full));
    } else if (entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

async function hashFile(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

async function imageDimensions(file) {
  try {
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeout: 10_000 });
    const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
    const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
    return {
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
    };
  } catch {
    return { width: undefined, height: undefined };
  }
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
