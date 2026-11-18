/** True while the holding drawer has unsaved text. The update button must not reload then. */
let dirty = false;
const listeners = new Set<() => void>();

export function setPwaEditDirty(next: boolean): void {
  if (dirty === next) return;
  dirty = next;
  for (const listener of listeners) listener();
}

export function isPwaEditDirty(): boolean {
  return dirty;
}

export function subscribePwaEditDirty(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A waiting worker reloads the page only when the drawer has no unsaved edit. */
export function updateAction(input: { waiting: boolean; dirty: boolean }): "reload" | "hold" | "idle" {
  if (!input.waiting) return "idle";
  if (input.dirty) return "hold";
  return "reload";
}
