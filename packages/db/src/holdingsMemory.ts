import type { HoldingLine, HoldingsStore } from "./holdings.js";

/** In-process stand-in. It does not execute TiDB and does not model isolation levels. */

type Draft = {
  id: string;
  userId: string;
  payloadJson: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
};

export function createHoldingsMemory(): HoldingsStore & {
  writes: { userId: string; mode: "replace" | "set" }[];
} {
  const lines = new Map<string, HoldingLine[]>();
  const applies = new Map<string, string>();
  const drafts: Draft[] = [];
  const writes: { userId: string; mode: "replace" | "set" }[] = [];
  return {
    writes,
    async list(userId) {
      return [...(lines.get(userId) ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    },
    async replaceAll(userId, next, now) {
      writes.push({ userId, mode: "replace" });
      lines.set(
        userId,
        next.map((line) => ({ ...line, updatedAt: now.toISOString() })),
      );
    },
    async setExact(userId, next, now) {
      writes.push({ userId, mode: "set" });
      const current = new Map((lines.get(userId) ?? []).map((line) => [line.code, line]));
      for (const line of next) {
        current.set(line.code, { ...line, updatedAt: now.toISOString() });
      }
      lines.set(userId, [...current.values()]);
    },
    async findApply(userId, key) {
      const hash = applies.get(`${userId}:${key}`);
      return hash ? { hash } : null;
    },
    async insertApply(userId, key, hash) {
      const id = `${userId}:${key}`;
      if (applies.has(id)) return false;
      applies.set(id, hash);
      return true;
    },
    async countDraftsSince(userId, since) {
      return drafts.filter((draft) => draft.userId === userId && draft.createdAt > since.getTime())
        .length;
    },
    async insertDraft(input) {
      drafts.push({
        id: input.id,
        userId: input.userId,
        payloadJson: input.payloadJson,
        expiresAt: input.expiresAt.getTime(),
        consumedAt: null,
        createdAt: input.now.getTime(),
      });
    },
    async readDraft(userId, id, now) {
      const draft = drafts.find((item) => item.id === id && item.userId === userId);
      if (!draft) return "missing";
      if (draft.consumedAt != null) return "consumed";
      if (draft.expiresAt <= now.getTime()) return "expired";
      return { payloadJson: draft.payloadJson };
    },
    async consumeDraft(userId, id, now) {
      const draft = drafts.find((item) => item.id === id && item.userId === userId);
      if (!draft) return "missing";
      if (draft.consumedAt != null || draft.expiresAt <= now.getTime()) return "lost";
      draft.consumedAt = now.getTime();
      return { payloadJson: draft.payloadJson };
    },
  };
}
