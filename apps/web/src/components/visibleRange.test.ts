import { describe, expect, it } from "vitest";

import { boundedRange, nextVisibleWindow, rangeNeedsApply } from "./VisibleRangeControl.js";

describe("visible range sync", () => {
  it("keeps the same state when the chart echoes the current window", () => {
    const current = { from: 20, to: 80, last: 100 };
    expect(nextVisibleWindow(current, { from: 20.02, to: 79.99 }, 100)).toBe(current);
    expect(rangeNeedsApply({ from: 20.02, to: 79.99 }, 20, 80)).toBe(false);
  });

  it("accepts a real chart pan and a real slider request", () => {
    const current = { from: 20, to: 80, last: 100 };
    expect(nextVisibleWindow(current, { from: 30, to: 90 }, 100)).toEqual({
      from: 30,
      to: 90,
      last: 100,
    });
    expect(rangeNeedsApply({ from: 20, to: 80 }, 30, 90)).toBe(true);
    expect(rangeNeedsApply(null, 30, 90)).toBe(true);
  });

  it("keeps a one-step window when a dense drag stacks the thumbs", () => {
    const previous = { start: 1184, end: 1211 };
    expect(boundedRange([1184, 1184], previous, 1211)).toEqual([1184, 1185]);
    expect(boundedRange([1211, 1211], previous, 1211)).toEqual([1210, 1211]);
    expect(boundedRange([900, 1100], previous, 1211)).toEqual([900, 1100]);
    expect(boundedRange([Number.NaN, 10], previous, 1211)).toBeNull();
    expect(boundedRange([1, 0], previous, 1211)).toEqual([0, 1]);
  });
});
