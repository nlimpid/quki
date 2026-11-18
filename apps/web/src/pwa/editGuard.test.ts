import { describe, expect, it } from "vitest";

import { isPwaEditDirty, setPwaEditDirty, updateAction } from "./editGuard.js";

describe("update prompt", () => {
  it("reloads only when a version is waiting and the editor is clean", () => {
    expect(updateAction({ waiting: false, dirty: false })).toBe("idle");
    expect(updateAction({ waiting: true, dirty: true })).toBe("hold");
    expect(updateAction({ waiting: true, dirty: false })).toBe("reload");
  });

  it("tracks the drawer dirty flag", () => {
    setPwaEditDirty(false);
    expect(isPwaEditDirty()).toBe(false);
    setPwaEditDirty(true);
    expect(isPwaEditDirty()).toBe(true);
    setPwaEditDirty(false);
  });
});
