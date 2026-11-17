import { describe, expect, it } from "vitest";

import { nextVisibleWindow, rangeNeedsApply } from "./VisibleRangeControl.js";

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
});
