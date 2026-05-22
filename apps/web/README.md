# Taste Web App

Next.js app and backend pipeline for turning uploaded reference images into a
final `SKILL.md`.

## Architecture

```text
frontend -> Next API routes -> direct Vercel runner -> @taste/ai -> Vercel AI Gateway
                         \-> Neon Postgres state
                         \-> Vercel Blob uploads/artifacts
```

The runner starts from `POST /api/runs/:runId/start`, then uses `after()` to
continue `processRun(runId)` after the HTTP response returns.

Generated artifacts are written under Vercel Blob paths like:

```text
runs/{runId}/01-corpus/images.jsonl
runs/{runId}/02-image-notes/raw/img_0001/openai_gpt-5.5.md
runs/{runId}/02-image-notes/raw/img_0001/anthropic_claude-sonnet-4.6.md
runs/{runId}/02-image-notes/synthesized/img_0001.md
runs/{runId}/03-rule-set/chunks/chunk_01-rules.md
runs/{runId}/03-rule-set/merges/merge_01_01-rules.md
runs/{runId}/03-rule-set/rule-set.md
runs/{runId}/04-skill/SKILL.md
```

## API Contract

All run-scoped routes after creation require the `runSecret` returned from
`POST /api/runs`, either as `x-run-secret` or `?runSecret=...`.

```text
POST /api/runs
  body: { aiGatewayToken?: string, expectedImageCount?: number }
  returns: { runId, runSecret, maxImages, maxImageBytes, acceptedTypes }

POST /api/uploads
  Vercel Blob client upload route.
  clientPayload: { runId, runSecret, uploadOrder, fileName, contentType, size }

POST /api/runs/:runId/images/complete
  Registers completed uploads for local/dev/e2e flows.

POST /api/runs/:runId/start
  Starts the direct Vercel pipeline runner.

POST /api/runs/:runId/process
  Resumes processing a queued/in-progress run.

POST /api/runs/:runId/cancel
  Cancels the run and purges any encrypted per-run AI Gateway token.

GET /api/runs/:runId
  Returns status, current step, progress, counters, and artifact readiness.

GET /api/runs/:runId/images
  Returns indexed images for progress thumbnails.

GET /api/runs/:runId/events?after=<id>
  Returns progress events after the given event id.

GET /api/runs/:runId/skill
  Returns the final SKILL.md once complete.
```

## Environment

```text
DATABASE_URL=...
APP_ENCRYPTION_KEY=32+ bytes or a 32-byte base64url/64-char hex key
BLOB_READ_WRITE_TOKEN=...
```

Optional speed/model defaults:

```text
MAX_IMAGES_PER_RUN=100
MAX_IMAGE_BYTES=10485760
ANALYSIS_MODELS=openai/gpt-5.5,anthropic/claude-sonnet-4.6
SYNTHESIS_MODEL=openai/gpt-5.5
RULE_MODEL=openai/gpt-5.5
SKILL_MODEL=openai/gpt-5.5
ANALYZE_IMAGE_CONCURRENCY=8
SYNTHESIZE_NOTE_CONCURRENCY=8
RULE_CHUNK_SIZE=10
RULE_MERGE_FAN_IN=6
```

## Development

```bash
npm install
npm run db:migrate --workspace @taste/web
npm run dev:web
```

## Production E2E

```bash
set -a
. .env.local
set +a
npm run e2e:prod
```

Use `TASTE_BASE_URL` to target a preview deployment.
