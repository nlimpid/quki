import {
  APPLY_LEASE_MS,
  type ApplyClaim,
  type HoldingLine,
  type HoldingsStore,
} from "./holdings.js";

/** In-process stand-in. It does not execute TiDB and does not model its locking. */

type Draft = {
  id: string;
  userId: string;
  payloadJson: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
};

type ApplyRow = {
  hash: string;
  status: "pending" | "applied";
  claimedAt: number;
};

type Attempt = {
  id: string;
  userId: string;
  status: "reserved" | "finished" | "failed" | "released";
  createdAt: number;
};

export function createHoldingsMemory(): HoldingsStore & {
  writes: { userId: string; mode: "replace" | "set" }[];
  attempts: Attempt[];
  failWrites: number;
  failComplete: boolean;
  blockWrite: Promise<void> | null;
  entered: number;
} {
  const lines = new Map<string, HoldingLine[]>();
  const applies = new Map<string, ApplyRow>();
  const drafts: Draft[] = [];
  const attempts: Attempt[] = [];
  const writes: { userId: string; mode: "replace" | "set" }[] = [];
  const gate = {
    failWrites: 0,
    failComplete: false,
    blockWrite: null as Promise<void> | null,
    entered: 0,
  };
  return {
    writes,
    attempts,
    get failWrites() {
      return gate.failWrites;
    },
    set failWrites(value: number) {
      gate.failWrites = value;
    },
    get failComplete() {
      return gate.failComplete;
    },
    set failComplete(value: boolean) {
      gate.failComplete = value;
    },
    get blockWrite() {
      return gate.blockWrite;
    },
    set blockWrite(value: Promise<void> | null) {
      gate.blockWrite = value;
    },
    get entered() {
      return gate.entered;
    },
    async list(userId) {
      return [...(lines.get(userId) ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    },
    async replaceAll(userId, next, now) {
      gate.entered += 1;
      if (gate.blockWrite) await gate.blockWrite;
      if (gate.failWrites > 0) {
        gate.failWrites -= 1;
        throw new Error("injected_write_failure");
      }
      writes.push({ userId, mode: "replace" });
      lines.set(
        userId,
        next.map((line) => ({ ...line, updatedAt: now.toISOString() })),
      );
    },
    async setExact(userId, next, now) {
      gate.entered += 1;
      if (gate.blockWrite) await gate.blockWrite;
      if (gate.failWrites > 0) {
        gate.failWrites -= 1;
        throw new Error("injected_write_failure");
      }
      writes.push({ userId, mode: "set" });
      const current = new Map((lines.get(userId) ?? []).map((line) => [line.code, line]));
      for (const line of next) {
        current.set(line.code, { ...line, updatedAt: now.toISOString() });
      }
      lines.set(userId, [...current.values()]);
    },
    async claimApply(userId, key, hash, now) {
      const id = `${userId}:${key}`;
      const existing = applies.get(id);
      if (!existing) {
        applies.set(id, { hash, status: "pending", claimedAt: now.getTime() });
        return "claimed";
      }
      if (existing.hash !== hash) return "conflict";
      if (existing.status === "applied") return "replay";
      if (now.getTime() - existing.claimedAt < APPLY_LEASE_MS) return "in_progress";
      existing.claimedAt = now.getTime();
      return "claimed" satisfies ApplyClaim;
    },
    async completeApply(userId, key, hash) {
      if (gate.failComplete) return false;
      const existing = applies.get(`${userId}:${key}`);
      if (!existing || existing.hash !== hash || existing.status !== "pending") return false;
      existing.status = "applied";
      return true;
    },
    async reserveAttempt(userId, now, limit, windowMs) {
      const cutoff = now.getTime() - windowMs;
      const active = attempts.filter(
        (attempt) =>
          attempt.userId === userId && attempt.createdAt > cutoff && attempt.status !== "released",
      );
      if (active.length >= limit) return "limited";
      const id = crypto.randomUUID();
      attempts.push({ id, userId, status: "reserved", createdAt: now.getTime() });
      return { id };
    },
    async finishAttempt(userId, id, status) {
      const attempt = attempts.find((item) => item.id === id && item.userId === userId);
      if (attempt && attempt.status === "reserved") attempt.status = status;
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
      if (draft.consumedAt == null && draft.expiresAt <= now.getTime()) return "expired";
      return { payloadJson: draft.payloadJson, consumed: draft.consumedAt != null };
    },
    async consumeDraft(userId, id, now) {
      const draft = drafts.find((item) => item.id === id && item.userId === userId);
      if (!draft) return "missing";
      if (draft.expiresAt <= now.getTime() && draft.consumedAt == null) return "expired";
      if (draft.consumedAt != null) return "lost";
      draft.consumedAt = now.getTime();
      return { payloadJson: draft.payloadJson };
    },
  };
}
