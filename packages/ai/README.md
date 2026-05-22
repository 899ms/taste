# AI Pipeline Package

Shared prompt and generation package for the web app backend.

## Purpose

The web app calls stable functions here for AI-backed pipeline steps instead of putting model calls and prompt assembly directly in API routes.

This package preserves the current command-line pipeline semantics while using the Vercel AI SDK and AI Gateway.

## Planned shape

```text
packages/ai/
  src/
    config.ts       # model defaults and output-token defaults
    prompts.ts      # analysis/synthesis/rule/skill prompts
    gateway.ts      # Vercel AI Gateway calls through AI SDK
    pipeline.ts     # step functions used by Inngest
    chunking.ts     # deterministic note chunking
```

Default analysis models:

```text
openai/gpt-5.5
anthropic/claude-sonnet-4.6
```

The package exposes generation functions for raw image analysis, synthesized image notes, rule chunks, the final rule set, and the final skill.
