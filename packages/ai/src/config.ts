export const DEFAULT_ANALYSIS_MODELS = [
  "openai/gpt-5.5",
  "anthropic/claude-sonnet-4-6",
] as const;

export const DEFAULT_SYNTHESIS_MODEL = "openai/gpt-5.5";
export const DEFAULT_RULE_MODEL = "openai/gpt-5.5";
export const DEFAULT_SKILL_MODEL = "openai/gpt-5.5";

export const DEFAULT_MAX_OUTPUT_TOKENS = {
  analysis: 4096,
  synthesizedNote: 4096,
  ruleChunk: 20000,
  ruleSet: 20000,
  skill: 12000,
} as const;

export const DEFAULT_SKILL_NAME = "taste";
const SKILL_DESCRIPTION = "Concrete UI visual rule set for generating and reviewing restrained neutral interfaces. Use for tasks that need exact style constraints: plain sans-serif typography, pale neutral canvases, rounded surfaces, soft shadows, minimal borders, low-saturation color, sparse density, content-neutral placeholders, and anti-collapse guardrails.";

export const SKILL_FRONTMATTER = buildSkillFrontmatter();

export function buildSkillFrontmatter(skillName?: string | null): string {
  const name = normalizeSkillName(skillName);
  return [
    "---",
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(SKILL_DESCRIPTION)}`,
    "---",
    "",
  ].join("\n");
}

export function normalizeSkillName(skillName?: string | null): string {
  const normalized = skillName?.replace(/\s+/g, " ").trim();
  return normalized || DEFAULT_SKILL_NAME;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
