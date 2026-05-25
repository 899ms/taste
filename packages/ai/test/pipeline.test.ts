import { describe, expect, it } from "vitest";

import { DEFAULT_SKILL_DESCRIPTION } from "../src/config";
import { parseSkillGenerationOutput } from "../src/pipeline";

describe("parseSkillGenerationOutput", () => {
  it("extracts a generated description and skill body from tagged output", () => {
    const parsed = parseSkillGenerationOutput(`
<skill-description>
"Saturated DIY poster rules with crude display type and rough print texture."
</skill-description>

<skill-body>
# bar-part-time

## Core directive
Use loud color and visible print wear.
</skill-body>
`);

    expect(parsed.description).toBe(
      "Saturated DIY poster rules with crude display type and rough print texture.",
    );
    expect(parsed.usedFallbackDescription).toBe(false);
    expect(parsed.body).toContain("# bar-part-time");
    expect(parsed.body).toContain("Use loud color");
    expect(parsed.body).not.toContain("<skill-body>");
  });

  it("falls back to a generic description when the generated description is unsafe", () => {
    const parsed = parseSkillGenerationOutput(`
<skill-description>
---
</skill-description>

<skill-body>
# taste
</skill-body>
`);

    expect(parsed.description).toBe(DEFAULT_SKILL_DESCRIPTION);
    expect(parsed.usedFallbackDescription).toBe(true);
    expect(parsed.body).toBe("# taste");
  });

  it("keeps untagged markdown as the body if a model misses the body tag", () => {
    const parsed = parseSkillGenerationOutput(`
<skill-description>Sharp black-and-white rules for dense typographic posters.</skill-description>

# taste

## Visual grammar
Use extreme value contrast.
`);

    expect(parsed.description).toBe("Sharp black-and-white rules for dense typographic posters.");
    expect(parsed.body).toContain("# taste");
    expect(parsed.body).toContain("Use extreme value contrast.");
    expect(parsed.body).not.toContain("<skill-description>");
  });
});
