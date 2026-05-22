# Taste

Taste is a Vercel-hosted web app that turns reference images into a reusable
design skill.

```text
apps/web/     # Next.js app, API routes, pipeline runner, database/storage code
packages/ai/  # shared prompts, model calls, chunking, skill generation helpers
pipeline/     # reference-image corpus and current generated skill
```

## Production Architecture

```text
browser uploads -> Next API routes -> direct Vercel runner -> Vercel AI Gateway
                                     -> Neon Postgres state
                                     -> Vercel Blob artifacts
```

The production runner is `apps/web/src/pipeline/run.ts`. It is invoked by
`POST /api/runs/:runId/start` and continues in a Vercel background task.

The current flow:

1. Upload reference images.
2. Index and dedupe the corpus.
3. Analyze each image with the configured model pair.
4. Start per-image synthesis as soon as that image's raw analyses finish.
5. Extract rule chunks from synthesized notes.
6. Merge chunks through an adaptive reduce tree when needed.
7. Generate the final `SKILL.md`.

Speed-first defaults:

```text
analysis models: openai/gpt-5.5 + anthropic/claude-sonnet-4.6
max images:      100
rule chunk size: 10 notes
merge fan-in:    6 chunks
AI access:       Vercel AI Gateway project auth, optional per-run override token
```

## Development

```bash
npm install
npm run db:migrate --workspace @taste/web
npm run dev:web
```

## Verification

```bash
npm run check
npm test
npm run e2e:prod --workspace @taste/web
```

The production E2E script requires `BLOB_READ_WRITE_TOKEN` and uses the checked
in reference images under `pipeline/taste/01-corpus/reference-images`.
