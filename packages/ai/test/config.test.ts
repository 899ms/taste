import { describe, expect, it } from "vitest";

import {
  buildSkillFrontmatter,
  DEFAULT_ANALYSIS_MODELS,
  normalizeSkillName,
  SKILL_FRONTMATTER,
} from "../src/config";

describe("model defaults", () => {
  it("uses the requested speed-first model pair", () => {
    expect(DEFAULT_ANALYSIS_MODELS).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-sonnet-4-6",
    ]);
  });

  it("quotes generated skill frontmatter scalars", () => {
    expect(SKILL_FRONTMATTER).toContain('name: "taste"');
    expect(buildSkillFrontmatter("Taste V2")).toContain('name: "Taste V2"');
    expect(buildSkillFrontmatter('taste: "sharp"')).toContain('name: "taste: \\"sharp\\""');
    expect(SKILL_FRONTMATTER).toContain('description: "');
  });

  it("normalizes blank skill names to the default", () => {
    expect(normalizeSkillName("  ")).toBe("taste");
    expect(normalizeSkillName("  mobile   surfaces  ")).toBe("mobile surfaces");
  });
});
