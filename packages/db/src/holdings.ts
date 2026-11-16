import { rowsOf, type SqlConn } from "./client.js";
import { formatSqlDateTime, rowsAffectedOf } from "./auth.js";

export type HoldingLine = {
  code: string;
  shares: number;
  updatedAt: string;
};

export type HoldingCashQuote = {
  code: string;
  name: string;
  ttmCashPerShare: string | null;
  yieldAsOf: string | null;
};

export type BookCommit =
  | { outcome: "written" | "replay"; items: HoldingLine[] }
  | { outcome: "conflict" | "draft_missing" | "draft_used" | "draft_expired" | "busy" };

type StoredApply = { hash: string; items: HoldingLine[] };
type StoredDraft = { payload: string; expiresAt: string; consumedBy: string | null };
type StoredAttempt = {
  id: string;
  at: string;
  status: "reserved" | "finished" | "failed" | "released";
};

type BookDocument = {
  items: HoldingLine[];
  applies: Record<string, StoredApply>;
  drafts: Record<string, StoredDraft>;
  attempts: StoredAttempt[];
};

type CommitInput = {
  userId: string;
  key: string;
  hash: string;
  mode: "replace" | "set" | "apply";
  lines: readonly HoldingLine[];
  draftId?: string;
  now: Date;
};

export type HoldingsStore = {
  list(userId: string): Promise<HoldingLine[]>;
  /** One compare-and-swap of the whole book. Replay does not write. */
  commit(input: CommitInput): Promise<BookCommit>;
  reserveAttempt(
    userId: string,
    now: Date,
    limit: number,
    windowMs: number,
  ): Promise<{ id: string } | "limited" | "busy">;
  finishAttempt(userId: string, id: string, status: "finished" | "failed"): Promise<void>;
  insertDraft(input: {
    id: string;
    userId: string;
    payloadJson: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  readDraft(
    userId: string,
    id: string,
    now: Date,
  ): Promise<{ payloadJson: string } | "missing" | "expired" | "used">;
};

function emptyDoc(): BookDocument {
  return { items: [], applies: {}, drafts: {}, attempts: [] };
}

export function planBookChange(
  doc: BookDocument,
  input: Omit<CommitInput, "userId">,
): { doc: BookDocument | null; result: BookCommit } {
  const existing = doc.applies[input.key];
  if (existing) {
    if (existing.hash !== input.hash) return { doc: null, result: { outcome: "conflict" } };
    return { doc: null, result: { outcome: "replay", items: existing.items.map((line) => ({ ...line })) } };
  }
  let drafts = doc.drafts;
  if (input.draftId) {
    const draft = doc.drafts[input.draftId];
    if (!draft) return { doc: null, result: { outcome: "draft_missing" } };
    if (draft.consumedBy) return { doc: null, result: { outcome: "draft_used" } };
    if (Date.parse(draft.expiresAt) <= input.now.getTime()) {
      return { doc: null, result: { outcome: "draft_expired" } };
    }
    drafts = {
      ...doc.drafts,
      [input.draftId]: { ...draft, consumedBy: input.key },
    };
  }
  const items =
    input.mode === "replace" ? normalize(input.lines) : mergeItems(doc.items, input.lines);
  return {
    doc: {
      ...doc,
      items,
      drafts,
      applies: { ...doc.applies, [input.key]: { hash: input.hash, items } },
    },
    result: { outcome: "written", items },
  };
}

function normalize(lines: readonly HoldingLine[]): HoldingLine[] {
  return [...lines].sort((a, b) => a.code.localeCompare(b.code));
}

function mergeItems(current: readonly HoldingLine[], lines: readonly HoldingLine[]): HoldingLine[] {
  const merged = new Map(current.map((line) => [line.code, line]));
  for (const line of lines) merged.set(line.code, line);
  return normalize([...merged.values()]);
}

function parseDoc(value: unknown): BookDocument {
  if (typeof value !== "string") return emptyDoc();
  const parsed = JSON.parse(value) as Partial<BookDocument>;
  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    applies: parsed.applies && typeof parsed.applies === "object" ? parsed.applies : {},
    drafts: parsed.drafts && typeof parsed.drafts === "object" ? parsed.drafts : {},
    attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
  };
}

export function createHoldingsStore(getConn: () => SqlConn): HoldingsStore {
  let conn: SqlConn | null = null;
  const db = () => (conn ??= getConn());
  return {
    async list(userId) {
      return (await readBook(db(), userId)).doc.items;
    },
    async commit(input) {
      const result = await mutate(db(), input.userId, input.now, (doc) => {
        const planned = planBookChange(doc, input);
        return { doc: planned.doc, value: planned.result };
      });
      return result === "busy" ? { outcome: "busy" } : result;
    },
    async reserveAttempt(userId, now, limit, windowMs) {
      const cutoff = now.getTime() - windowMs;
      const result = await mutate(db(), userId, now, (doc): {
        doc: BookDocument | null;
        value: { id: string } | "limited";
      } => {
        const active = doc.attempts.filter(
          (attempt) => Date.parse(attempt.at) > cutoff && attempt.status !== "released",
        );
        if (active.length >= limit) return { doc: null, value: "limited" as const };
        const id = crypto.randomUUID();
        return {
          doc: {
            ...doc,
            attempts: [...doc.attempts, { id, at: now.toISOString(), status: "reserved" as const }],
          },
          value: { id },
        };
      });
      return result;
    },
    async finishAttempt(userId, id, status) {
      const result = await mutate(db(), userId, new Date(), (doc) => ({
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
      const result = await mutate(db(), input.userId, input.now, (doc) => {
        if (doc.drafts[input.id]) return { doc: null, value: false };
        return {
          doc: {
            ...doc,
            drafts: {
              ...doc.drafts,
              [input.id]: {
                payload: input.payloadJson,
                expiresAt: input.expiresAt.toISOString(),
                consumedBy: null,
              },
            },
          },
          value: true,
        };
      });
      if (result === "busy") throw new Error("book_busy");
    },
    async readDraft(userId, id, now) {
      const draft = (await readBook(db(), userId)).doc.drafts[id];
      if (!draft) return "missing";
      if (draft.consumedBy) return "used";
      if (Date.parse(draft.expiresAt) <= now.getTime()) return "expired";
      return { payloadJson: draft.payload };
    },
  };
}

async function readBook(conn: SqlConn, userId: string): Promise<{ version: number; doc: BookDocument }> {
  const result = await conn.execute(
    "SELECT version, document FROM auth_user_books WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const row = rowsOf(result)[0];
  if (!row) return { version: 0, doc: emptyDoc() };
  const version = typeof row.version === "number" ? row.version : Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("book_version");
  return { version, doc: parseDoc(row.document) };
}

async function mutate<T>(
  conn: SqlConn,
  userId: string,
  now: Date,
  decide: (doc: BookDocument) => { doc: BookDocument | null; value: T },
): Promise<T | "busy"> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readBook(conn, userId);
    const decision = decide(current.doc);
    if (!decision.doc) return decision.value;
    const text = JSON.stringify(decision.doc);
    if (text.length > 60_000) throw new Error("book_too_large");
    const wrote =
      current.version === 0
        ? await insertBook(conn, userId, text, now)
        : await updateBook(conn, userId, current.version, text, now);
    if (wrote) return decision.value;
  }
  return "busy";
}

async function insertBook(conn: SqlConn, userId: string, text: string, now: Date): Promise<boolean> {
  try {
    const inserted = await conn.execute(
      "INSERT INTO auth_user_books (user_id, version, document, updated_at) VALUES (?, 1, ?, ?)",
      [userId, text, formatSqlDateTime(now)],
    );
    return rowsAffectedOf(inserted) === 1;
  } catch {
    return false;
  }
}

async function updateBook(
  conn: SqlConn,
  userId: string,
  version: number,
  text: string,
  now: Date,
): Promise<boolean> {
  const updated = await conn.execute(
    "UPDATE auth_user_books SET version = ?, document = ?, updated_at = ? WHERE user_id = ? AND version = ?",
    [version + 1, text, formatSqlDateTime(now), userId, version],
  );
  return rowsAffectedOf(updated) === 1;
}

export async function lookupHoldingCash(
  conn: SqlConn,
  codes: readonly string[],
): Promise<HoldingCashQuote[]> {
  const unique = [...new Set(codes)].filter((code) => /^\d{6}$/.test(code));
  if (unique.length === 0) return [];
  const marks = unique.map(() => "?").join(", ");
  const result = await conn.execute(
    `SELECT code, name, CAST(ttm_cash_per_share AS CHAR) AS ttm_cash, DATE_FORMAT(yield_as_of, '%Y-%m-%d') AS yield_as_of FROM companies WHERE listing_status = 'listed' AND code IN (${marks})`,
    [...unique],
  );
  const quotes: HoldingCashQuote[] = [];
  for (const row of rowsOf(result)) {
    const code = typeof row.code === "string" ? row.code : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!/^\d{6}$/.test(code) || name.length === 0) continue;
    quotes.push({
      code,
      name,
      ttmCashPerShare:
        typeof row.ttm_cash === "string" && row.ttm_cash !== "NULL" ? row.ttm_cash : null,
      yieldAsOf: typeof row.yield_as_of === "string" ? row.yield_as_of : null,
    });
  }
  return quotes;
}
