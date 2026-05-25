import type { ChunkSpec, RuleChunkResult, TasteImage } from "./types";

export function buildAnalysisPrompt(image: TasteImage): string {
  return `You are analyzing one visual reference image as part of a design taste corpus. The image is a verified, human-curated example of a desired visual direction. Your task is to extract the aesthetic DNA, not explain the product, event, brand, interface, document, object, or scene.

Be specific and visual. Do not give generic praise. Do not merely list visible elements.

CRITICAL FOCUS: This analysis is about aesthetics and taste only: style, layout, hierarchy, color, light, materials, marks, texture, typography, spacing, composition, density, rhythm, visual tension, finish, and mood. The image's domain, scenario, copy, names, depicted objects, and functional workflow are not the target. Treat them as incidental raw material unless they reveal a broader aesthetic move.

Do not create principles tied to subject matter, such as "make it guest-focused," "make it nightlife-themed," "make it medical," or "make it collectible." Translate what you see into visual principles such as scale relationships, type behavior, color roles, edge treatment, texture systems, illustration logic, image treatment, composition, repetition, and hierarchy.

Extract transferable aesthetic principles that could guide unrelated work in the same taste. The target may be an interface, poster, graphic system, document, cover, illustration, product page, brand asset, dashboard, or another visual medium.

Image metadata:
- id: ${image.id}
- filename: ${image.basename}
- dimensions: ${formatDimensions(image)}

Write a deep analysis with these sections:

# ${image.id} — ${image.basename}

## 1. Visual composition only
Briefly describe the visual arrangement, major shapes, alignment, surfaces, marks, textures, and focal points. Keep functional/domain description minimal.

## 2. What makes the aesthetic strong
Identify the strongest visual qualities and why they work as design/taste moves, independent of the reference content.

## 3. Layout and composition principles
Discuss grid, alignment, framing, hierarchy, grouping, density, whitespace, edge pressure, repetition, cropping, and visual rhythm.

## 4. Typography principles
Discuss scale, weight, contrast, text density, labels, headings, and how type creates hierarchy.

## 5. Color, material, light, texture, and depth principles
Discuss palette, contrast, gradients, shadows, borders, surfaces, opacity, texture, print/noise, rendering style, and finish.

## 6. Aesthetic mood / vibe
Describe the visual vibe using domain-independent aesthetic language. Avoid product/domain interpretations.

## 7. Transferable aesthetic principles
List 10-18 principles that could guide unrelated work in the same taste. Phrase these as reusable visual design rules, not observations and not domain/content advice.

## 8. What to ignore as incidental
List content, copy, subject matter, domain, depicted objects, and functional details that should NOT become taste rules.

## 9. Aesthetic tags
Provide 10-20 concise, domain-independent tags.
`;
}

export function buildSynthesisPrompt(input: {
  image: TasteImage;
  analyses: Array<{ model?: string | null; text: string }>;
}): string {
  const analysisSections = buildAnonymousAnalysisSections(input.analyses);
  return `You are rectifying one or more independent visual analyses of the same visual reference image into one canonical master vision note for a design taste corpus. The image is a verified, human-curated example of a desired visual direction. Your job is to extract aesthetic DNA, not product meaning.

This master note is about aesthetics and taste only: style, layout, hierarchy, color, light, materials, marks, texture, typography, spacing, composition, density, rhythm, visual tension, finish, and mood. The image's domain, scenario, copy, names, depicted objects, and functional workflow are not the target. Treat them as incidental raw material unless they reveal a broader aesthetic move.

Do not preserve domain or subject-matter interpretations as taste rules. Translate them into visible design behavior: scale, rhythm, typography, color relationships, shape language, mark-making, image treatment, texture, density, framing, and material handling.

The analyses below are intentionally anonymized and source-neutral. Treat them as peer evidence. Do not infer which model produced either analysis, and do not favor an analysis because it resembles your own wording. Adjudicate disagreements by looking at the image again.

Look at the image again. Use the analyses as evidence, but correct anything that seems too functional, content-specific, overstated, brand-specific, or not actually visible. Preserve sharp aesthetic insights. Remove duplication. The output should become the definitive per-image taste note for later cross-image synthesis.

Image metadata:
- id: ${input.image.id}
- filename: ${input.image.basename}
- dimensions: ${formatDimensions(input.image)}

${analysisSections}

Write the master note with this structure:

# ${input.image.id} — ${input.image.basename} Master Vision

## 1. Visual summary
A concise but specific description of the visual composition only: shapes, alignment, hierarchy, surfaces, marks, texture, density, and focal points. Keep domain/function minimal.

## 2. Why this aesthetic works
The most important visual strengths and why they matter as design/taste moves, independent of the reference content.

## 3. Transferable aesthetic principles
12-18 reusable aesthetic/design principles, phrased as rules that could guide unrelated work. These must be domain-independent and should not mention the image's scenario, content, or function.

## 4. Pattern categories
Group the principles under layout/composition, typography/lettering, color/value, material/texture/depth, imagery/shape, density/spacing, aesthetic mood, and avoidance.

## 5. What is incidental or too literal
Reference content, functionality, product category, copy, depicted objects, names, scenario, or reference-specific details that should not become general taste rules.

## 6. Evidence tags
15-25 concise, domain-independent aesthetic tags that will help cluster this image with others later.
`;
}

function buildAnonymousAnalysisSections(
  analyses: Array<{ model?: string | null; text: string }>,
): string {
  const sourceModels = analyses
    .map((analysis) => analysis.model)
    .filter((model): model is string => typeof model === "string" && model.trim().length > 0);

  return analyses
    .map((analysis, index) => {
      const text = anonymizeAnalysisText(analysis.text, sourceModels);
      return `Analysis ${index + 1}:\n---\n${text}\n---`;
    })
    .join("\n\n");
}

function anonymizeAnalysisText(text: string, sourceModels: string[]): string {
  const body = stripLeadingFrontmatter(text);
  return modelAliases(sourceModels).reduce(
    (current, alias) => current.replace(new RegExp(escapeRegExp(alias), "gi"), "[redacted]"),
    body,
  );
}

function stripLeadingFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function modelAliases(models: string[]): string[] {
  return Array.from(
    new Set(
      models.flatMap((model) => {
        const bare = model.includes("/") ? (model.split("/").pop() ?? model) : model;
        const spaced = bare.replace(/[-_]+/g, " ");
        return [model, bare, spaced];
      }),
    ),
  ).filter((alias) => alias.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildChunkPrompt(spec: ChunkSpec): string {
  const bundle = spec.notes
    .map((note) => `\n\n<image-note file="${note.file}">\n${note.text}\n</image-note>`)
    .join("\n");
  return `You are extracting a STRICT, concrete visual rule set from a deterministic subset of canonical image notes.

The previous attempt failed because it over-generalized into broad mood words and model-prior defaults. Your task is to avoid that failure without suppressing the actual visual evidence.

DO NOT summarize the images with unsupported praise or taste labels. Words like beautiful, tasteful, premium, elevated, or polished are not useful as standalone rules.

DO preserve descriptive aesthetic labels when the image notes support them, but pair each label with visible constraints. For example, if the notes support editorial, atmospheric, cinematic, luxury, fashion, boutique, lifestyle, handmade, crude, corporate, archival, punk, playful, serif, display type, or utilitarian, translate the label into concrete decisions about scale, type, color, texture, imagery, shape, spacing, and composition.

DO extract direct production rules a model can follow without making open-ended aesthetic decisions.

A good rule is:
- observable in the image notes,
- specific enough to implement,
- transferable across domains,
- declarative, not optional,
- about visible design decisions: typography, lettering, color, value, texture, light, shadow, shape, spacing, density, alignment, borders, surfaces, imagery, marks, composition, medium, and finish.

A bad rule is:
- mood/vibe language,
- a broad principle such as "make it premium",
- an invitation for the model to choose a style,
- tied to product domain/content/copy,
- a stereotype copied from model priors instead of evidence in the notes.

Chunk ${spec.id}
Files: ${spec.notes.map((note) => note.file).join(", ")}

Input notes:${bundle}

Write a chunk rule extraction with these exact sections:

# ${spec.id} Concrete Visual Rules

## Rules to keep
Write 40-70 specific, imperative rules. Be dictator-driven. Prefer "Use...", "Set...", "Avoid...", "Do not...". Do not hedge with "often" unless the source genuinely conflicts.

## Numeric / relational constraints
Where exact values are unavailable, give useful relative constraints supported by the notes: saturation level, palette breadth, type scale contrast, line weight, border strength, texture intensity, image scale, spacing, density, repetition, crop behavior, and hierarchy.

## Prohibited model shortcuts
List concrete shortcuts the generator must not use, but only include shortcuts supported by the risk in this chunk or by obvious model-prior risk. Do not blacklist a typeface category, color family, medium, subject category, or aesthetic label merely because it can be clichéd.

## Source-specific content to discard
List content/domain/copy/signifier observations that should not become style rules.
`;
}

export function buildRuleSetPrompt(chunkResults: RuleChunkResult[]): string {
  const drafts = chunkResults
    .map((result) => `\n\n<chunk-rules id="${result.id}" files="${result.files.join(",")}">\n${result.text}\n</chunk-rules>`)
    .join("\n");
  return `You are synthesizing chunk-level rule drafts into one STRICT visual rule set for a design-generation skill.

The previous skill failed by using vague taste words and fixed fallback aesthetics that caused model-prior collapse. Do not repeat that mistake.

You must produce a concrete, declarative, specific, somewhat long rule set. It is okay if it is longer than a typical skill. Specificity is the goal. Do not leave aesthetic choices open for the generator when the reference taste can constrain them.

BANNED AS UNSUPPORTED STYLE GUIDANCE:
Do not use empty praise such as beautiful, tasteful, premium, elevated, or polished as standalone generation rules. Descriptive labels are allowed only when translated into concrete visual constraints backed by the chunk evidence.

REQUIRED BEHAVIOR:
- Convert every abstract finding into a visible production constraint.
- Default to the concrete choices best supported by the chunk evidence.
- Preserve distinct clusters or tensions if the references contain more than one visual mode; do not flatten them into a single generic style.
- Forbid stereotype shortcuts only when they are unsupported by evidence or when the chunk drafts identify them as failure risks.
- Keep the design language transferable across domains and media. The aesthetic must come from visible structure, not invented content.
- Do not include image IDs, chunk IDs, evidence references, or process notes in the final rule set.
- Make compatible exceptions explicit and bounded; do not leave broad freedom.

Chunk rule drafts:${drafts}

Write the final rule set with this exact structure:

# Taste Rule Set

## 1. Purpose
A short explanation that this is a concrete visual production rule set, not a mood board.

## 2. Recurring visual grammar
15-25 top-level defaults the generator should follow unless the user explicitly asks otherwise. These defaults must be derived from repeated evidence in the chunk drafts.

## 3. Composition and layout rules
Specific rules for framing, scale relationships, alignment, cropping, grouping, whitespace, density, edge behavior, repetition, hierarchy, and rhythm.

## 4. Typography, lettering, and mark rules
Specific rules for type categories, display behavior, scale, weight, spacing, alignment, legibility, distortion, word/image relationships, labels, and hierarchy.

## 5. Color and value rules
Specific rules for palette breadth, saturation, contrast, color roles, value structure, accents, status/semantic color only when relevant, and color interactions.

## 6. Imagery, shape, texture, material, and depth rules
Specific rules for image treatment, illustration, geometry, surface finish, print/noise/grain, shadows, borders, opacity, rendering style, and material cues.

## 7. Content and subject treatment
Specific rules for what content details can carry the aesthetic, what must remain incidental, how labels/copy/names should behave, and whether subject matter should be abstracted, literal, generic, or preserved.

## 8. Medium-specific application rules
Specific rules for applying the taste to the media supported by the evidence, such as posters, interfaces, documents, dashboards, covers, illustrations, product pages, or brand assets. Include component/state guidance only when the evidence is interface-oriented.

## 9. Anti-patterns and banned shortcuts
A direct blacklist of visual/content shortcuts that caused or could cause collapse. Each shortcut must be tied to evidence in the drafts or an obvious model-prior risk.

## 10. Final generation checklist
A concrete checklist the generator must pass before finishing.
`;
}

export function buildSkillPrompt(ruleSet: string, skillName = "taste"): string {
  return `Convert this concrete visual rule set into a platform-agnostic design skill.

Keep it dictator-driven and specific. Do not soften it into broad aesthetic prose. Length is acceptable. The target model should not infer the aesthetic from vague words.

Use this exact plain-text skill title when a title is needed: ${JSON.stringify(skillName)}

Rules:
- Preserve concrete visual constraints.
- Use imperative language.
- Do not use empty praise such as beautiful, tasteful, premium, elevated, or polished as standalone guidance.
- Preserve descriptive aesthetic labels from the rule set only when they are paired with concrete visual constraints.
- Derive typography, color, texture, density, imagery, material, content-treatment, and medium defaults from the rule set.
- Do not force interface, poster, document, brand, product, or illustration conventions unless the rule set supports them.
- Make collapse guardrails explicit, but tailor them to the reference evidence rather than using generic bans.
- Do not mention source images, chunks, models, APIs, experiments, or this process.
- Do not include YAML frontmatter.

Output exactly these tagged blocks:

<skill-description>
One concise sentence describing the generated visual taste. Derive it from the rule set. Do not mention source images, models, APIs, or this process.
</skill-description>

<skill-body>

Required Markdown body structure:

# ${skillName}

## Use this skill when

## Core directive

## Visual grammar

## Composition and layout

## Typography and lettering

## Color and value

## Imagery, shape, texture, and material

## Content and subject treatment

## Medium-specific rules

## Forbidden shortcuts

## Generation checklist

</skill-body>

Rule set:

<rule-set>
${ruleSet}
</rule-set>
`;
}

function formatDimensions(image: TasteImage): string {
  return `${image.width ?? "unknown"}x${image.height ?? "unknown"}`;
}
