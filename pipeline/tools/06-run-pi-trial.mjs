#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const promptPath = readFlag("--prompt");
const workspace = readFlag("--workspace");
const skillSource = readFlag("--skill-source") ?? "pipeline/taste/04-skill";
const skillPath = readFlag("--skill") ?? (workspace ? "skills/taste-design" : "pipeline/taste/04-skill");
const configDir = readFlag("--config-dir") ?? "pipeline/taste/00-config/pi-headless";
const provider = readFlag("--provider") ?? "shopify-anthropic";
const model = readFlag("--model") ?? "anthropic:claude-opus-4-7";
const thinking = readFlag("--thinking") ?? "medium";
const logDir = readFlag("--log-dir") ?? "pipeline/taste/05-pi-trial/logs";
const latestName = readFlag("--latest-name") ?? "latest-pi-headless.jsonl";
const tools = readFlag("--tools") ?? "write";
const clean = !hasFlag("--no-clean");
const streamJson = hasFlag("--stream-json");
const inlineSkill = !hasFlag("--no-inline-skill");

if (!promptPath) {
  console.error("Usage: node pipeline/tools/06-run-pi-trial.mjs --prompt <prompt.md> [--workspace <dir>]");
  process.exit(1);
}

if (!process.env.SHOPIFY_AI_TOKEN) {
  console.error("Missing SHOPIFY_AI_TOKEN. Export it in the shell; this script does not store it.");
  process.exit(1);
}

await main();

async function main() {
  await mkdir(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const logPath = path.resolve(logDir, `pi-headless-${timestamp}.jsonl`);
  const stderrPath = logPath.replace(/\.jsonl$/, ".stderr.log");
  const latestPath = path.resolve(logDir, latestName);
  const cwd = workspace ? path.resolve(workspace) : process.cwd();
  const promptText = await readFile(promptPath, "utf8");
  const skillSourcePath = path.resolve(skillSource);

  if (workspace) {
    if (clean) await rm(cwd, { recursive: true, force: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(path.join(cwd, "skills"), { recursive: true });
    await cp(skillSourcePath, path.join(cwd, "skills", "taste-design"), { recursive: true });
  }

  let appendedSystem = [
    "Benchmark hygiene for this run:",
    "- Treat the current working directory as the entire project.",
    "- Do not inspect parent directories or unrelated project/process files.",
    "- Use only the task brief and the benchmark skill below as guidance.",
    "- Do not infer extra brand, platform, device, or content direction unless the task explicitly asks for it.",
  ].join("\n");

  if (inlineSkill) {
    const skillFile = workspace
      ? path.join(cwd, "skills", "taste-design", "SKILL.md")
      : path.join(skillSourcePath, "SKILL.md");
    const skillText = await readFile(skillFile, "utf8");
    appendedSystem += `\n\nMANDATORY BENCHMARK SKILL BODY:\nThe following skill is already loaded into this session. Apply it directly. Do not search for other skill or project files.\n\n<benchmark-skill>\n${skillText}\n</benchmark-skill>`;
  } else {
    appendedSystem += `\n\nMANDATORY: before producing the artifact, read and apply ${skillPath}/SKILL.md. Do not read other project files.`;
  }

  const argv = [
    "--mode", "json",
    "--no-session",
    "--provider", provider,
    "--model", model,
    "--thinking", thinking,
    "--tools", tools,
    "--no-extensions",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-skills",
    "--skill", skillPath,
    "--append-system-prompt", appendedSystem,
    promptText,
  ];

  console.error(`Workspace: ${cwd}`);
  console.error(`Running isolated headless Pi with ${provider}/${model}:${thinking}`);
  console.error(`Skill source: ${skillSourcePath}`);
  console.error(`Inline skill: ${inlineSkill}`);
  console.error(`Tools: ${tools}`);
  console.error(`Prompt: ${path.resolve(promptPath)}`);
  console.error(`JSON log: ${logPath}`);

  const child = spawn("pi", argv, {
    cwd,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: path.resolve(configDir),
      PI_SKIP_VERSION_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(chunk);
    if (streamJson) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });

  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  await Promise.all([
    writeFile(logPath, Buffer.concat(stdoutChunks)),
    writeFile(stderrPath, Buffer.concat(stderrChunks)),
  ]);

  try { await unlink(latestPath); } catch {}
  await symlink(logPath, latestPath);

  if (code !== 0) {
    console.error(`pi exited with code ${code}`);
    process.exit(code ?? 1);
  }
  console.error(`Done. JSON log: ${logPath}`);
}

function hasFlag(name) {
  return args.includes(name);
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}
