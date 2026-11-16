import { planBookChange, reclaimBook, MAX_LIVE_DRAFTS, type HoldingsStore } from "./holdings.js";

/** In-process compare-and-swap. It does not execute TiDB and does not open a transaction. */

type BookDocument = Parameters<typeof planBookChange>[0];

function emptyDoc(): BookDocument {
  return { items: [], applies: {}, drafts: {}, attempts: [] };
}

export function createHoldingsMemory(): HoldingsStore & {
  writes: number;
  commits: number;
  entered: number;
  failWrites: number;
  pauseNext: boolean;
  gate: Promise<void> | null;
  attempts: { id: string; status: string }[];
} {
  const books = new Map<string, { version: number; doc: BookDocument }>();
  const gate = {
    writes: 0,
    commits: 0,
    entered: 0,
    failWrites: 0,
    pauseNext: false,
    block: null as Promise<void> | null,
  };
  async function mutate<T>(
    userId: string,
    now: Date,
    decide: (doc: BookDocument) => { doc: BookDocument | null; value: T },
  ): Promise<T | "busy"> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = books.get(userId) ?? { version: 0, doc: emptyDoc() };
      const decision = decide(structuredClone(current.doc));
      if (!decision.doc) return decision.value;
      gate.entered += 1;
      if (gate.pauseNext) {
        gate.pauseNext = false;
        await gate.block;
      }
      if (gate.failWrites > 0) {
        gate.failWrites -= 1;
        throw new Error("injected_write_failure");
      }
      const latest = books.get(userId)?.version ?? 0;
      if (latest !== current.version) continue;
      books.set(userId, { version: current.version + 1, doc: decision.doc });
      gate.writes += 1;
      return decision.value;
    }
    return "busy";
  }
  return {
    get writes() {
      return gate.writes;
    },
    get commits() {
      return gate.commits;
    },
    get entered() {
      return gate.entered;
    },
    get failWrites() {
      return gate.failWrites;
    },
    set failWrites(value: number) {
      gate.failWrites = value;
    },
    get pauseNext() {
      return gate.pauseNext;
    },
    set pauseNext(value: boolean) {
      gate.pauseNext = value;
    },
    get gate() {
      return gate.block;
    },
    set gate(value: Promise<void> | null) {
      gate.block = value;
    },
    get attempts() {
      return [...books.values()].flatMap((row) =>
        row.doc.attempts.map((attempt) => ({ id: attempt.id, status: attempt.status })),
      );
    },
    async list(userId) {
      return books.get(userId)?.doc.items.map((line) => ({ ...line })) ?? [];
    },
    async commit(input) {
      const before = gate.writes;
      const result = await mutate(input.userId, input.now, (doc) => {
        const planned = planBookChange(doc, input);
        return { doc: planned.doc, value: planned.result };
      });
      if (result !== "busy" && result.outcome === "written" && gate.writes > before) gate.commits += 1;
      return result === "busy" ? { outcome: "busy" } : result;
    },
    async reserveAttempt(userId, now, limit, windowMs) {
      const cutoff = now.getTime() - windowMs;
      return mutate(userId, now, (doc): {
        doc: BookDocument | null;
        value: { id: string } | "limited";
      } => {
        const pruned = reclaimBook(doc, now);
        const changed = JSON.stringify(pruned) !== JSON.stringify(doc);
        const active = pruned.attempts.filter(
          (attempt) => Date.parse(attempt.at) > cutoff && attempt.status !== "released",
        );
        if (active.length >= limit) return { doc: changed ? pruned : null, value: "limited" as const };
        const id = crypto.randomUUID();
        return {
          doc: {
            ...pruned,
            attempts: [...pruned.attempts, { id, at: now.toISOString(), status: "reserved" as const }],
          },
          value: { id },
        };
      });
    },
    async finishAttempt(userId, id, status) {
      const result = await mutate(userId, new Date(), (doc) => ({
        doc: {
          ...doc,
          attempts: doc.attempts.map((attempt) =>
            attempt.id === id && attempt.status === "reserved" ? { ...attempt, status } : attempt,
          ),
        },
        value: true,
      }));
      if (result === "busy") throw new Error("book_busy");
    },
    async insertDraft(input) {
      const result = await mutate(input.userId, input.now, (doc) => {
        const pruned = reclaimBook(doc, input.now);
        const changed = JSON.stringify(pruned) !== JSON.stringify(doc);
        if (pruned.drafts[input.id]) return { doc: changed ? pruned : null, value: "duplicate" as const };
        const next: BookDocument = {
          ...pruned,
          drafts: {
            ...pruned.drafts,
            [input.id]: {
              payload: input.payloadJson,
              expiresAt: input.expiresAt.toISOString(),
              consumedBy: null,
            },
          },
        };
        if (Object.keys(pruned.drafts).length >= MAX_LIVE_DRAFTS || JSON.stringify(next).length > 48_000) {
          return { doc: changed ? pruned : null, value: "full" as const };
        }
        return { doc: next, value: "inserted" as const };
      });
      if (result === "busy") throw new Error("book_busy");
      if (result === "full") throw new Error("window_full");
    },
    async readDraft(userId, id, now) {
      const draft = books.get(userId)?.doc.drafts[id];
      if (!draft) return "missing";
      if (draft.consumedBy) return "used";
      if (Date.parse(draft.expiresAt) <= now.getTime()) return "expired";
      return { payloadJson: draft.payload };
    },
  };
}
