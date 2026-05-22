# Web App

Reserved home for the product web app. Do not add framework/app code here until we intentionally start the build.

## Rollout plan

### 1. Internal Shopify app first

Target: Shopify-internal users.

Expected AI source:

```text
Shopify internal AI/proxy APIs
```

This version can assume internal authentication, network access, and AI credentials/configuration available only inside Shopify.

### 2. External app later

Target: users outside Shopify.

Expected AI source:

```text
public/commercial AI provider APIs or customer-configured provider credentials
```

This version should reuse the same product surfaces where possible. The main planned difference is the AI usage API source, not the core app workflow.

## Architectural constraint

Keep AI usage behind a provider boundary from the start:

```text
web app -> AI service interface -> provider adapter
                              -> shopify-internal adapter first
                              -> external provider adapter later
```

Do not scatter direct AI API calls through UI/routes. The Shopify-internal and external versions should swap AI providers through configuration or deployment target.

See [`../../packages/ai/README.md`](../../packages/ai/README.md) for the reserved AI provider package plan.
