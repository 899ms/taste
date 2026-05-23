import { describe, expect, it } from "vitest";

import { mapConcurrent } from "../src/pipeline/utils";
import { workflowDrainSlots } from "../src/workflow/runner";

describe("workflow drain slots", () => {
  it("creates concrete work items for every drain slot", async () => {
    const visited: number[] = [];

    await mapConcurrent(workflowDrainSlots(4), 4, async (slot) => {
      visited.push(slot);
    });

    expect(visited.sort()).toEqual([0, 1, 2, 3]);
  });
});
