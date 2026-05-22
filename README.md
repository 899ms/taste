# Taste

This repo is organized for three separate concerns:

```text
pipeline/     # existing taste-skill process, tools, and generated artifacts
apps/web/     # reserved home for the future web app; not built yet
packages/ai/  # reserved AI provider boundary for internal vs external AI sources
```

## Pipeline

The current design-taste pipeline lives under [`pipeline/`](pipeline/):

```text
pipeline/process.md  # operating manual
pipeline/tools/      # one small script per pipeline step
pipeline/taste/      # numbered artifacts from corpus -> notes -> rule set -> skill -> trial
```

Start with [`pipeline/process.md`](pipeline/process.md).

Current final skill:

```text
pipeline/taste/04-skill/SKILL.md
```

## Web app

The future web app has a reserved location at [`apps/web/`](apps/web/). It is intentionally only documentation/placeholders for now.

Build order:

1. **Internal Shopify web app** — uses Shopify internal AI/proxy APIs.
2. **External web app** — uses external/public AI APIs or customer-configured AI credentials.

The core app should be shared where possible. The AI API source should be isolated behind the provider boundary in [`packages/ai/`](packages/ai/).
