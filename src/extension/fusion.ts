import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import type { SubagentParamsLike } from "../runs/foreground/subagent-executor.ts";
import type { SingleResult, Usage } from "../shared/types.ts";
import { getSingleResultOutput } from "../shared/utils.ts";

export const FusionParams = Type.Object({
	prompt: Type.String({
		description: "The exact question or task to ask every selected model.",
	}),
	models: Type.Array(Type.String({
		description: "Model id for one anonymous panelist, e.g. 'openai/gpt-5.5' or 'anthropic/claude-opus-4-6:high'.",
	}), {
		minItems: 2,
		maxItems: 12,
		description: "Models to ask independently. Each model receives the same prompt.",
	}),
	agent: Type.Optional(Type.String({
		description: "Subagent persona to use for each model. Defaults to the built-in read-only 'fusion-respondent'.",
	})),
	context: Type.Optional(Type.String({
		enum: ["fresh", "fork"],
		description: "Run child agents with fresh context or fork the current conversation context. Defaults to fresh.",
	})),
	agentScope: Type.Optional(Type.String({
		description: "Agent discovery scope: 'user', 'project', or 'both' (default: 'both'; project wins on name collisions).",
	})),
	cwd: Type.Optional(Type.String({ description: "Working directory for child agents." })),
	instructions: Type.Optional(Type.String({
		description: "Extra instructions appended to each model's panelist prompt.",
	})),
	concurrency: Type.Optional(Type.Integer({
		minimum: 1,
		description: "Maximum number of model panelists to run at once. Defaults to pi-subagents parallel defaults.",
	})),
	maxOutputChars: Type.Optional(Type.Integer({
		minimum: 1000,
		maximum: 200000,
		description: "Maximum characters from each candidate answer to include in the parent synthesis context. Defaults to 24000.",
	})),
	style: Type.Optional(Type.String({
		enum: ["balanced", "concise", "detailed", "decision"],
		description: "Synthesis style requested from the parent agent. Defaults to balanced.",
	})),
});

export type FusionParamsType = Static<typeof FusionParams>;

interface FusionCandidateDetails {
	label: string;
	model: string;
	exitCode: number;
	status: "completed" | "failed" | "empty";
	outputChars: number;
	truncated: boolean;
	usage?: Usage;
	durationMs?: number;
	sessionFile?: string;
	attemptedModels?: string[];
}

interface FusionDetails {
	mode: "fusion";
	runId?: string;
	prompt: string;
	agent: string;
	style: string;
	candidateCount: number;
	succeeded: number;
	failed: number;
	candidates: FusionCandidateDetails[];
}

interface RegisterFusionToolDeps {
	executeSubagent: (
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<unknown>) => void) | undefined,
		ctx: ExtensionContext,
	) => Promise<AgentToolResult<{ runId?: string; results?: SingleResult[] }>> | AgentToolResult<{ runId?: string; results?: SingleResult[] }>;
}

const DEFAULT_FUSION_AGENT = "fusion-respondent";
const DEFAULT_MAX_OUTPUT_CHARS = 24_000;

function normalizeModels(models: string[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const raw of models) {
		const model = raw.trim();
		if (!model || seen.has(model)) continue;
		seen.add(model);
		normalized.push(model);
	}
	return normalized;
}

function labelForIndex(index: number): string {
	let n = index;
	let label = "";
	do {
		label = String.fromCharCode(65 + (n % 26)) + label;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return label;
}

function shuffledIndexes(length: number): number[] {
	const indexes = Array.from({ length }, (_, index) => index);
	for (let i = indexes.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
	}
	return indexes;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modelRedactionTerms(models: string[]): string[] {
	const terms = new Set<string>();
	for (const model of models) {
		const trimmed = model.trim();
		if (!trimmed) continue;
		const withoutThinking = trimmed.replace(/:(off|minimal|low|medium|high|xhigh)$/i, "");
		terms.add(withoutThinking);
		const id = withoutThinking.split("/").pop();
		if (id && id.length >= 4) {
			terms.add(id);
			terms.add(id.replaceAll("-", " "));
		}
	}
	return [...terms].sort((left, right) => right.length - left.length);
}

function redactSelectedModelNames(output: string, models: string[]): string {
	let redacted = output;
	for (const term of modelRedactionTerms(models)) {
		redacted = redacted.replace(new RegExp(escapeRegExp(term), "gi"), "[model identity redacted]");
	}
	return redacted;
}

function truncateCandidateOutput(output: string, maxChars: number): { text: string; truncated: boolean } {
	if (output.length <= maxChars) return { text: output, truncated: false };
	const omitted = output.length - maxChars;
	return {
		text: `${output.slice(0, maxChars).trimEnd()}\n\n[Candidate answer truncated by Fusion: ${omitted} additional characters omitted.]`,
		truncated: true,
	};
}

function buildPanelistTask(params: FusionParamsType): string {
	const extra = params.instructions?.trim();
	return [
		"You are one anonymous panelist in a multi-model Fusion run.",
		"Answer the user's prompt independently. Do not mention your model name, provider, identity, or that you are part of a panel.",
		"Optimize for correctness, useful nuance, and clear reasoning. If the prompt involves repository code, inspect only what you need and avoid modifying files.",
		"Return a self-contained answer; another agent will later synthesize anonymous candidate answers.",
		extra ? `Additional user instructions for this panelist:\n${extra}` : undefined,
		"User prompt:",
		"---",
		params.prompt,
		"---",
	].filter((line): line is string => Boolean(line)).join("\n\n");
}

function formatStyleInstruction(style: string): string {
	switch (style) {
		case "concise":
			return "Keep the fused answer concise while preserving any important caveats or corrections.";
		case "detailed":
			return "Produce a detailed fused answer with enough explanation to justify the final recommendation.";
		case "decision":
			return "Produce a decision-oriented fused answer: lead with the recommendation, then concise rationale, tradeoffs, and next steps.";
		default:
			return "Produce a balanced fused answer: direct, complete, and not longer than needed.";
	}
}

function buildSynthesisContext(input: {
	prompt: string;
	style: string;
	candidates: Array<{ label: string; status: "completed" | "failed" | "empty"; text: string; truncated: boolean }>;
}): string {
	const candidateBlocks = input.candidates.map((candidate) => {
		if (candidate.status !== "completed") {
			return `<candidate id="${candidate.label}" status="${candidate.status}">\nThis candidate did not produce a usable answer.\n</candidate>`;
		}
		const truncationNote = candidate.truncated ? " truncated=\"true\"" : "";
		return `<candidate id="${candidate.label}"${truncationNote}>\n${candidate.text}\n</candidate>`;
	}).join("\n\n");

	return [
		"Fusion panel complete. The candidate answers below are anonymous and shuffled; their labels are arbitrary and are not model identities.",
		"Your job as the parent agent is to synthesize one primary answer for the user using substance only.",
		"Synthesis rules:",
		"- Do not mention or guess which model produced any candidate.",
		"- Prefer claims that are well-supported, concrete, and mutually reinforced.",
		"- Resolve conflicts by weighing reasoning quality, evidence, and consistency with the original prompt, not candidate order.",
		"- Include useful minority insights when they improve the answer, but do not average incompatible claims.",
		"- If candidates disagree or are uncertain, state the uncertainty plainly and give the safest recommendation.",
		`- ${formatStyleInstruction(input.style)}`,
		"Original user prompt:",
		"---",
		input.prompt,
		"---",
		"Anonymous candidate answers:",
		candidateBlocks,
		"Now write the fused final answer to the user.",
	].join("\n\n");
}

function compactFailureText(result: SingleResult | undefined): string {
	if (!result) return "No result returned.";
	if (result.error) return result.error;
	const output = getSingleResultOutput(result).trim();
	return output || `Child exited with code ${result.exitCode}.`;
}

export function registerFusionTool(pi: ExtensionAPI, deps: RegisterFusionToolDeps): void {
	const tool: ToolDefinition<typeof FusionParams, FusionDetails> = {
		name: "fusion",
		label: "Fusion",
		description: `Ask multiple selected models the same prompt through anonymous subagents, then return anonymized candidate answers for the parent agent to fuse into one unbiased final answer.

Use this when the user asks for Fusion, multi-model consensus, model comparison without revealing model identities to the synthesizer, or wants several model opinions combined. Always provide the user's prompt and the chosen models. The tool deliberately hides model names from its textual output; model-to-candidate mapping is kept only in tool details for UI/audit.`,
		promptSnippet: "Ask multiple selected models the same prompt and synthesize their anonymous answers into one final response",
		promptGuidelines: [
			"Use fusion when the user asks to ask multiple models, run Fusion, get a multi-model consensus, or combine several model opinions.",
			"After fusion returns anonymous candidates, synthesize one final answer for the user without mentioning or guessing model identities.",
		],
		parameters: FusionParams,

		async execute(id, params, signal, _onUpdate, ctx) {
			const models = normalizeModels(params.models);
			if (models.length < 2) {
				throw new Error("Fusion requires at least two distinct non-empty model ids.");
			}

			const agent = params.agent?.trim() || DEFAULT_FUSION_AGENT;
			const maxOutputChars = params.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
			const style = params.style ?? "balanced";
			const childTask = buildPanelistTask(params);

			const subagentResult = await deps.executeSubagent(
				`${id}-panel`,
				{
					tasks: models.map((model) => ({ agent, task: childTask, model })),
					...(params.concurrency !== undefined ? { concurrency: params.concurrency } : {}),
					context: params.context === "fork" ? "fork" : "fresh",
					...(params.cwd ? { cwd: params.cwd } : {}),
					...(params.agentScope ? { agentScope: params.agentScope } : {}),
					async: false,
					clarify: false,
					includeProgress: false,
				},
				signal,
				undefined,
				ctx,
			);

			const results = subagentResult.details?.results ?? [];
			const ordered = models.map((model, index) => ({ model, result: results[index] }));
			const randomOrder = shuffledIndexes(ordered.length);
			const candidates = randomOrder.map((sourceIndex, anonymousIndex) => {
				const source = ordered[sourceIndex]!;
				const result = source.result;
				const rawOutput = result ? getSingleResultOutput(result).trim() : "";
				const status: FusionCandidateDetails["status"] = !result || result.exitCode !== 0
					? "failed"
					: rawOutput
						? "completed"
						: "empty";
				const output = status === "completed" ? redactSelectedModelNames(rawOutput, models) : compactFailureText(result);
				const truncated = truncateCandidateOutput(output, maxOutputChars);
				const label = labelForIndex(anonymousIndex);
				return {
					label,
					model: source.model,
					status,
					text: truncated.text,
					truncated: truncated.truncated,
					result,
				};
			});

			const details: FusionDetails = {
				mode: "fusion",
				runId: subagentResult.details?.runId,
				prompt: params.prompt,
				agent,
				style,
				candidateCount: candidates.length,
				succeeded: candidates.filter((candidate) => candidate.status === "completed").length,
				failed: candidates.filter((candidate) => candidate.status !== "completed").length,
				candidates: candidates.map((candidate): FusionCandidateDetails => ({
					label: candidate.label,
					model: candidate.model,
					exitCode: candidate.result?.exitCode ?? -1,
					status: candidate.status,
					outputChars: candidate.text.length,
					truncated: candidate.truncated,
					usage: candidate.result?.usage,
					durationMs: candidate.result?.progressSummary?.durationMs ?? candidate.result?.progress?.durationMs,
					sessionFile: candidate.result?.sessionFile,
					attemptedModels: candidate.result?.attemptedModels,
				})),
			};

			const synthesisContext = buildSynthesisContext({
				prompt: params.prompt,
				style,
				candidates: candidates.map((candidate) => ({
					label: candidate.label,
					status: candidate.status,
					text: candidate.text,
					truncated: candidate.truncated,
				})),
			});

			return {
				content: [{ type: "text", text: synthesisContext }],
				details,
			};
		},

		renderCall(args, theme) {
			const count = Array.isArray(args.models) ? args.models.length : 0;
			return new Text(`${theme.fg("toolTitle", theme.bold("fusion "))}${count} model${count === 1 ? "" : "s"}`, 0, 0);
		},

		renderResult(result, options, theme) {
			const details = result.details;
			if (!details) return new Text("Fusion completed", 0, 0);
			const icon = details.failed > 0 ? theme.fg("warning", "◐") : theme.fg("success", "✓");
			let text = `${icon} Fusion panel complete: ${details.succeeded}/${details.candidateCount} anonymous candidates ready for synthesis`;
			if (options.expanded) {
				for (const candidate of details.candidates) {
					const status = candidate.status === "completed" ? theme.fg("success", "completed") : theme.fg("warning", candidate.status);
					text += `\n  ${candidate.label}: ${status} ${theme.fg("dim", `(${candidate.model})`)}`;
				}
			} else if (details.failed > 0) {
				text += theme.fg("dim", ` · ${details.failed} unavailable`);
			}
			return new Text(text, 0, 0);
		},
	};

	pi.registerTool(tool);
}
