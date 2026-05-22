# AI Provider Boundary

Reserved package for the web app's AI integration layer. No implementation yet.

## Purpose

The web app will ship in two phases:

1. **Internal Shopify use** — AI requests go through Shopify internal AI/proxy APIs.
2. **Outside Shopify use** — AI requests go through external/public AI APIs or user/customer-configured credentials.

The app should call a stable internal interface here instead of calling provider APIs directly.

## Planned shape

```text
packages/ai/
  src/
    index.ts                 # public app-facing interface
    providers/
      shopify-internal.ts    # first implementation
      external.ts            # later implementation
```

The interface should hide provider-specific details like auth headers, model naming, base URLs, rate-limit semantics, logging requirements, and request/response normalization.

## Rule for app code

When implementation begins, `apps/web` should depend on this package/interface for AI work. UI components and route handlers should not import Shopify AI clients or external AI SDKs directly.
