import { describe, expect, it } from "vitest";

import { chunkSynthesizedNotes } from "../src/chunking";

describe("chunkSynthesizedNotes", () => {
  it("includes every note exactly once in deterministic image order", () => {
    const notes = [
      { imageId: "img_0003", file: "img_0003.md", text: "3" },
      { imageId: "img_0001", file: "img_0001.md", text: "1" },
      { imageId: "img_0002", file: "img_0002.md", text: "2" },
    ];

    const chunks = chunkSynthesizedNotes(notes, 2);

    expect(chunks).toEqual([
      {
        id: "chunk_01",
        notes: [
          { imageId: "img_0001", file: "img_0001.md", text: "1" },
          { imageId: "img_0002", file: "img_0002.md", text: "2" },
        ],
      },
      {
        id: "chunk_02",
        notes: [{ imageId: "img_0003", file: "img_0003.md", text: "3" }],
      },
    ]);
  });
});
