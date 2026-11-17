import { describe, expect, it } from "vitest";

import { bandSegments } from "./bandFill.js";

describe("rotation band segments", () => {
  it("keeps real boundaries and breaks the fill where one side is missing", () => {
    const segments = bandSegments([
      { time: "2024-01-05", upper: 2, lower: 1 },
      { time: "2024-01-12", upper: 2.2, lower: 1.1 },
      { time: "2024-01-19", upper: null, lower: 1 },
      { time: "2024-01-26", upper: 2, lower: null },
      { time: "2024-02-02", upper: 3, lower: 1 },
      { time: "2024-02-09", upper: 3.1, lower: 1.2 },
    ]);
    expect(segments).toEqual([
      [
        { time: "2024-01-05", upper: 2, lower: 1 },
        { time: "2024-01-12", upper: 2.2, lower: 1.1 },
      ],
      [
        { time: "2024-02-02", upper: 3, lower: 1 },
        { time: "2024-02-09", upper: 3.1, lower: 1.2 },
      ],
    ]);
  });
});
