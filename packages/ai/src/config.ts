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
export const DEFAULT_SKILL_DESCRIPTION =
  "Concrete visual taste rules generated from reference images.";

export const SKILL_FRONTMATTER = buildSkillFrontmatter();

export function buildSkillFrontmatter(
  input?:
    | string
    | null
    | {
        skillName?: string | null | undefined;
        description?: string | null | undefined;
      },
): string {
  const name = normalizeSkillName(typeof input === "string" || input === null ? input : input?.skillName);
  const description =
    typeof input === "object" && input !== null
      ? (normalizeSkillDescription(input.description) ?? DEFAULT_SKILL_DESCRIPTION)
      : DEFAULT_SKILL_DESCRIPTION;
  return [
    "---",
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(description)}`,
    "---",
    "",
  ].join("\n");
}

export function normalizeSkillName(skillName?: string | null): string {
  const normalized = skillName?.replace(/\s+/g, " ").trim();
  return normalized || DEFAULT_SKILL_NAME;
}

export function normalizeSkillDescription(description?: string | null): string | null {
  let normalized = description
    ?.replace(/^description\s*:\s*/i, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  normalized = stripMatchingQuotes(normalized);
  if (!normalized || normalized.includes("---") || /<[^>]+>/.test(normalized)) return null;
  if (normalized.length > 240) {
    normalized = normalized.slice(0, 240).replace(/\s+\S*$/, "").trim();
  }
  return normalized || null;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function stripMatchingQuotes(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}
