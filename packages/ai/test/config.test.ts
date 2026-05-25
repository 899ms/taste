import { describe, expect, it } from "vitest";

import {
  buildSkillFrontmatter,
  DEFAULT_ANALYSIS_MODELS,
  DEFAULT_SKILL_DESCRIPTION,
  normalizeSkillDescription,
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
    expect(SKILL_FRONTMATTER).toContain(
      `description: ${JSON.stringify(DEFAULT_SKILL_DESCRIPTION)}`,
    );
    expect(buildSkillFrontmatter("Taste V2")).toContain('name: "Taste V2"');
    expect(buildSkillFrontmatter('taste: "sharp"')).toContain('name: "taste: \\"sharp\\""');
    expect(
      buildSkillFrontmatter({
        skillName: "bar-part-time",
        description: "Saturated poster rules with rough print texture.",
      }),
    ).toContain('description: "Saturated poster rules with rough print texture."');
    expect(SKILL_FRONTMATTER).not.toContain("restrained neutral");
  });

  it("normalizes blank skill names to the default", () => {
    expect(normalizeSkillName("  ")).toBe("taste");
    expect(normalizeSkillName("  mobile   surfaces  ")).toBe("mobile surfaces");
  });

  it("normalizes generated skill descriptions", () => {
    expect(normalizeSkillDescription(' "Saturated poster rules." ')).toBe(
      "Saturated poster rules.",
    );
    expect(normalizeSkillDescription("description: Rough type\nand flat color")).toBe(
      "Rough type and flat color",
    );
    expect(normalizeSkillDescription("---")).toBeNull();
    expect(normalizeSkillDescription("<skill-description>bad</skill-description>")).toBeNull();
  });
});
