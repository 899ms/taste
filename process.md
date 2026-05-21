# Taste Skill Process

This repo is a local, linear workflow for turning a curated set of interface screenshots into one reusable Pi design skill.

It is intentionally not a Pi package. The only things here are:

1. `process.md` — the operating manual.
2. `tools/` — small scripts for each step.
3. `taste/` — numbered artifacts from the current successful path.

## Current artifact structure

```text
taste/
  00-config/
    pi-headless/
      models.json          # local Pi model config for Shopify-proxy Claude Opus 4.7
      auth.json            # empty; token stays in SHOPIFY_AI_TOKEN only

  01-corpus/
    reference-images/      # checked-in source screenshots used by this run
    images.jsonl           # indexed source screenshots, repo paths, hashes, dimensions

  02-image-notes/
    raw/                   # per-image raw analyses: GPT-5.5 + Claude Opus 4.7
      img_0001/
        openai_gpt-5.5.md
        anthropic_claude-opus-4-7.md
      ...
    synthesized/           # one canonical master note per image
      img_0001.md
      ...

  03-rule-set/
    chunks/                # random chunk rule extractions from synthesized notes
    rule-set.md            # final concrete visual production rule set

  04-skill/
    SKILL.md               # current Pi-loadable taste skill

  05-pi-trial/
    prompt.md              # functional-only benchmark prompt
    workspace/
      profile.html         # generated artifact from the current clean trial
    screenshots/
      desktop.png          # rendered screenshot of the generated artifact
```

Generated cache/log folders may appear while running tools, but they are not part of the durable artifact path.

## Current tools

```text
tools/01-index-images.mjs
  Index source screenshots into taste/01-corpus/images.jsonl.

tools/02-analyze-images.mjs
  Analyze every image with openai/gpt-5.5 and anthropic/claude-opus-4-7.

tools/03-synthesize-image-notes.mjs
  Rectify each pair of raw analyses into one canonical master note per image.

tools/04-synthesize-rule-set.mjs
  Extract concrete visual rules from randomized chunks of synthesized image notes,
  then synthesize taste/03-rule-set/rule-set.md.

tools/05-generate-skill.mjs
  Convert the concrete rule set into taste/04-skill/SKILL.md.

tools/06-run-pi-trial.mjs
  Run an isolated headless Pi generation trial with the skill inlined and write-only tools.
```

## Required models

Per-image visual analysis uses both:

```text
openai/gpt-5.5
anthropic/claude-opus-4-7
```

Synthesis/rule/skill generation currently uses:

```text
openai/gpt-5.5
```

Headless design trials use:

```text
provider: shopify-anthropic
model: anthropic:claude-opus-4-7
```

All proxy calls require:

```bash
export SHOPIFY_AI_TOKEN=...
```

Do not write the token into repo files or logs.

## Core constraints

1. Analyze aesthetics only: layout, type, spacing, density, color, shadows, radius, surfaces, hierarchy, composition, polish, restraint.
2. Treat product domain, copy, names, workflows, depicted objects, and app category as incidental unless they reveal a transferable visible design move.
3. Analyze actual screenshots, not filenames or descriptions.
4. Each image gets two independent raw analyses before synthesis.
5. The final skill must be concrete and directive, not poetic or vibe-based.
6. Avoid broad mood labels as generation guidance. Words like `luxury`, `premium`, `editorial`, `tactile`, `warm`, `refined`, `boutique`, and `elegant` cause model-prior collapse.
7. Prefer direct production rules: plain sans typography, pale neutral canvas, white rounded surfaces, soft low-opacity shadows, minimal hairline borders, restrained accent color, content neutrality.
8. Explicitly ban known shortcuts: beige/tan/terracotta default palettes, serif display names, monogram avatars, boutique/fashion/lifestyle copy, fake phone frames, OS chrome, stock-photo-led layouts, glossy/glass/neumorphic effects.
9. Benchmark prompts must be functional only. The prompt says what to build and where to save it; the skill supplies the visual taste.
10. Benchmark runs must be isolated. The trial agent should not read this repo, process notes, old outputs, reference images, or logs.
11. Inline the full skill body for benchmark reliability and give the trial agent only the `write` tool by default.
12. Audit the JSON trial log before trusting a generated artifact.

## Linear process

### 1. Collect screenshots

Put curated screenshots in a source folder. Current source used for this run:

```text
/Users/jaytel/Desktop/taste-selects
```

### 2. Index the corpus

```bash
node tools/01-index-images.mjs /Users/jaytel/Desktop/taste-selects taste/01-corpus/images.jsonl
```

Output:

```text
taste/01-corpus/images.jsonl
```

This records image IDs, paths, hashes, byte sizes, and dimensions.

### 3. Analyze every image with both vision models

```bash
SHOPIFY_AI_TOKEN=... node tools/02-analyze-images.mjs \
  --index taste/01-corpus/images.jsonl \
  --out taste/02-image-notes/raw \
  --concurrency 8
```

Output shape:

```text
taste/02-image-notes/raw/img_0001/openai_gpt-5.5.md
taste/02-image-notes/raw/img_0001/anthropic_claude-opus-4-7.md
```

The analysis prompt tells models to focus on visible aesthetic decisions only.

### 4. Synthesize one master note per image

```bash
SHOPIFY_AI_TOKEN=... node tools/03-synthesize-image-notes.mjs \
  --index taste/01-corpus/images.jsonl \
  --per-image taste/02-image-notes/raw \
  --out taste/02-image-notes/synthesized \
  --concurrency 8
```

Output:

```text
taste/02-image-notes/synthesized/img_0001.md
...
taste/02-image-notes/synthesized/img_0028.md
```

Each synthesized note is the canonical visual reading for one screenshot.

### 5. Extract a concrete visual rule set

Do not synthesize broad taste principles. Extract strict, transferable production rules from randomized chunks of image notes.

```bash
SHOPIFY_AI_TOKEN=... node tools/04-synthesize-rule-set.mjs \
  --input taste/02-image-notes/synthesized \
  --rule-out taste/03-rule-set/rule-set.md \
  --chunks 4 \
  --chunk-size 7 \
  --concurrency 4
```

Outputs:

```text
taste/03-rule-set/chunks/<run-id>/chunk_01-rules.md
taste/03-rule-set/chunks/<run-id>/chunk_02-rules.md
taste/03-rule-set/chunks/<run-id>/chunk_03-rules.md
taste/03-rule-set/chunks/<run-id>/chunk_04-rules.md
taste/03-rule-set/rule-set.md
```

The rule set is the important pivot: it keeps the aesthetic as explicit visible decisions instead of vague mood language.

### 6. Generate the Pi skill

```bash
SHOPIFY_AI_TOKEN=... node tools/05-generate-skill.mjs \
  --rule-set taste/03-rule-set/rule-set.md \
  --out taste/04-skill/SKILL.md
```

Output:

```text
taste/04-skill/SKILL.md
```

This is the current reusable taste skill.

### 7. Run a clean headless Pi trial

Use a functional-only prompt. Current trial prompt:

```text
taste/05-pi-trial/prompt.md
```

Run:

```bash
SHOPIFY_AI_TOKEN=... node tools/06-run-pi-trial.mjs \
  --prompt taste/05-pi-trial/prompt.md \
  --workspace taste/05-pi-trial/workspace \
  --skill-source taste/04-skill \
  --tools write \
  --thinking medium
```

The runner:

- creates/cleans the workspace,
- copies the skill into the isolated workspace,
- inlines the full skill body into the system prompt,
- disables unrelated Pi resources,
- gives the agent only the requested tools,
- runs with `--no-session`,
- writes JSON logs under `taste/05-pi-trial/logs/`.

Current clean artifact:

```text
taste/05-pi-trial/workspace/profile.html
taste/05-pi-trial/screenshots/desktop.png
```

## Why the process is this strict

An earlier attempt turned the image corpus into broad taste language. That failed because the generator filled vague words with its own priors: beige luxury commerce, serif names, monogram avatars, terracotta accents, boutique copy, and fake lifestyle branding.

The working fix was:

```text
vague aesthetic principles -> concrete visual production rules
normal skill discovery -> inline full skill body
open workspace/tools -> isolated workspace with write-only tools
style-heavy benchmark prompt -> functional-only benchmark prompt
```

Keep this discipline. The skill should behave like a strict visual spec, not a mood board.

## What should not be in this repo

- Fusion/Pi extension source code.
- Failed skill versions.
- Failed benchmark workspaces.
- Broad mood-principle drafts.
- Long run logs as durable artifacts.
- Cached proxy images.
- Tokens or secrets.

If a future experiment fails, record the lesson in this process file if useful, then remove the failed artifacts so the repo remains a clear path from screenshots to skill.
