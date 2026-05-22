import { describe, expect, it } from "vitest";

import { DEFAULT_ANALYSIS_MODELS } from "../src/config";

describe("model defaults", () => {
  it("uses the requested speed-first model pair", () => {
    expect(DEFAULT_ANALYSIS_MODELS).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-sonnet-4.6",
    ]);
  });
});
