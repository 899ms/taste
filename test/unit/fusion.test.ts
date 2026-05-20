import assert from "node:assert/strict";
import { test } from "node:test";
import { registerFusionTool } from "../../src/extension/fusion.ts";

function usage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 };
}

test("fusion returns anonymous candidates while keeping model mapping in details", async () => {
	const tools: any[] = [];
	const pi = { registerTool(tool: any) { tools.push(tool); } };

	registerFusionTool(pi as any, {
		executeSubagent: async (_id, params: any) => {
			assert.equal(params.tasks.length, 2);
			assert.equal(params.tasks[0].model, "openai/gpt-5.5");
			assert.equal(params.tasks[1].model, "anthropic/claude-opus-4-6");
			return {
				content: [],
				details: {
					runId: "run-1",
					results: [
						{ agent: "fusion-respondent", task: "", exitCode: 0, usage: usage(), finalOutput: "Use option A. As gpt-5.5, I prefer it." },
						{ agent: "fusion-respondent", task: "", exitCode: 0, usage: usage(), finalOutput: "Option A is safest; watch the migration risk." },
					],
				},
			};
		},
	});

	assert.equal(tools.length, 1);
	const result = await tools[0].execute(
		"fusion-test",
		{
			prompt: "Choose A or B",
			models: ["openai/gpt-5.5", "anthropic/claude-opus-4-6"],
		},
		new AbortController().signal,
		undefined,
		{ hasUI: false },
	);

	const text = result.content[0].text;
	assert.match(text, /<candidate id="A"/);
	assert.match(text, /<candidate id="B"/);
	assert.doesNotMatch(text, /openai|anthropic|gpt-5\.5|claude-opus/i);
	assert.match(text, /Use option A|Option A is safest/);
	assert.deepEqual(
		result.details.candidates.map((candidate: any) => candidate.model).sort(),
		["anthropic/claude-opus-4-6", "openai/gpt-5.5"].sort(),
	);
});
