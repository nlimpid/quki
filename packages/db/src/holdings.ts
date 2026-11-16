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

/** Original idempotency id stays acceptable while serverNow - timestamp is at most this long. */
export const OPERATION_RETENTION_MS = 10 * 60 * 1000;
/**
 * Implementation bounds, not an approved product quota.
 * A confirmed clear counts as one of the four unexpired saves.
 */
export const MAX_LIVE_APPLIES = 4;
export const MAX_LIVE_DRAFTS = 2;

export type BookCommit =
  | { outcome: "written" | "replay"; items: HoldingLine[] }
  | {
      outcome:
        | "conflict"
        | "draft_missing"
        | "draft_used"
        | "draft_expired"
        | "expired"
        | "window_full"
        | "malformed_key"
        | "busy";
    };

type StoredApply = { hash: string; expiresAt: string; items: HoldingLine[] };
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

function attemptStatus(value: string): StoredAttempt["status"] {
  if (value === "reserved" || value === "finished" || value === "failed" || value === "released") {
    return value;
  }
  throw new Error("book_corrupt");
}

function parseVersion(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && String(parsed) === value) return parsed;
  }
  throw new Error("book_corrupt");
}

function emptyDoc(): BookDocument {
  return { items: [], applies: {}, drafts: {}, attempts: [] };
}

const OP_RE =
  /^op\.v1\.(\d{13})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Formats `op.v1.{serverNowMs}.{uuid}` for the normal response body.
 * The string is not stored here, not an authentication credential, and not a checked issuance.
 * Any well-formed id inside the server-clock window is a new operation until that exact string is stored.
 */
export function issueOperationToken(now: Date): string {
  return `op.v1.${String(now.getTime()).padStart(13, "0")}.${crypto.randomUUID()}`;
}

/** Shape plus server clock. More than 60s ahead is malformed. Older than 10 minutes is expired. */
export function classifyOperationToken(key: string, now: Date): "ok" | "malformed" | "expired" {
  const match = OP_RE.exec(key);
  if (!match?.[1]) return "malformed";
  const issued = Number(match[1]);
  if (!Number.isSafeInteger(issued)) return "malformed";
  if (issued > now.getTime() + 60_000) return "malformed";
  if (now.getTime() - issued > OPERATION_RETENTION_MS) return "expired";
  return "ok";
}

function expiresAt(key: string): string {
  const issued = Number(OP_RE.exec(key)?.[1] ?? 0);
  return new Date(issued + OPERATION_RETENTION_MS).toISOString();
}

export function reclaimBook(doc: BookDocument, now: Date): BookDocument {
  const cutoff = now.getTime();
  const applies: BookDocument["applies"] = {};
  for (const [key, record] of Object.entries(doc.applies)) {
    if (Date.parse(record.expiresAt) >= cutoff) applies[key] = record;
  }
  const drafts: BookDocument["drafts"] = {};
  for (const [id, draft] of Object.entries(doc.drafts)) {
    if (Date.parse(draft.expiresAt) >= cutoff) drafts[id] = draft;
  }
  return {
    items: doc.items,
    applies,
    drafts,
    attempts: doc.attempts.filter(
      (attempt) => Date.parse(attempt.at) + OPERATION_RETENTION_MS >= cutoff,
    ),
  };
}

export function planBookChange(
  doc: BookDocument,
  input: Omit<CommitInput, "userId">,
): { doc: BookDocument | null; result: BookCommit } {
  const keyState = classifyOperationToken(input.key, input.now);
  const pruned = reclaimBook(doc, input.now);
  const reclaimed = JSON.stringify(pruned) !== JSON.stringify(doc);
  if (keyState === "malformed") return { doc: reclaimed ? pruned : null, result: { outcome: "malformed_key" } };
  if (keyState === "expired") return { doc: reclaimed ? pruned : null, result: { outcome: "expired" } };
  const existing = pruned.applies[input.key];
  if (existing) {
    if (existing.hash !== input.hash) return { doc: reclaimed ? pruned : null, result: { outcome: "conflict" } };
    return {
      doc: reclaimed ? pruned : null,
      result: { outcome: "replay", items: existing.items.map((line) => ({ ...line })) },
    };
  }
  let drafts = pruned.drafts;
  if (input.draftId) {
    const draft = pruned.drafts[input.draftId];
    if (!draft) return { doc: reclaimed ? pruned : null, result: { outcome: "draft_missing" } };
    if (draft.consumedBy) return { doc: reclaimed ? pruned : null, result: { outcome: "draft_used" } };
    if (Date.parse(draft.expiresAt) <= input.now.getTime()) {
      return { doc: reclaimed ? pruned : null, result: { outcome: "draft_expired" } };
    }
    drafts = { ...pruned.drafts, [input.draftId]: { ...draft, consumedBy: input.key } };
  }
  if (!/^[0-9a-f]{64}$/i.test(input.hash)) {
    return { doc: reclaimed ? pruned : null, result: { outcome: "malformed_key" } };
  }
  assertWritableLines(input.lines);
  if (Object.keys(pruned.applies).length >= MAX_LIVE_APPLIES) {
    return { doc: reclaimed ? pruned : null, result: { outcome: "window_full" } };
  }
  if (input.draftId && Object.keys(drafts).length > MAX_LIVE_DRAFTS) {
    return { doc: reclaimed ? pruned : null, result: { outcome: "window_full" } };
  }
  const items = input.mode === "replace" ? normalize(input.lines) : mergeItems(pruned.items, input.lines);
  const next: BookDocument = {
    ...pruned,
    items,
    drafts,
    applies: {
      ...pruned.applies,
      [input.key]: { hash: input.hash, expiresAt: expiresAt(input.key), items },
    },
  };
  if (JSON.stringify(next).length > 48_000) {
    return { doc: reclaimed ? pruned : null, result: { outcome: "window_full" } };
  }
  return { doc: next, result: { outcome: "written", items } };
}

function assertWritableLines(lines: readonly HoldingLine[]): void {
  const seen = new Set<string>();
  for (const line of lines) {
    if (!/^\d{6}$/.test(line.code) || seen.has(line.code)) throw new Error("invalid_holding");
    if (typeof line.shares !== "number" || !Number.isSafeInteger(line.shares) || line.shares < 1 || line.shares > 1_000_000_000) {
      throw new Error("invalid_holding");
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(line.updatedAt)) throw new Error("invalid_holding");
    seen.add(line.code);
  }
}

function normalize(lines: readonly HoldingLine[]): HoldingLine[] {
  return [...lines].sort((a, b) => a.code.localeCompare(b.code));
}

function mergeItems(current: readonly HoldingLine[], lines: readonly HoldingLine[]): HoldingLine[] {
  const merged = new Map(current.map((line) => [line.code, line]));
  for (const line of lines) merged.set(line.code, line);
  return normalize([...merged.values()]);
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseItems(value: unknown): HoldingLine[] {
  if (!Array.isArray(value)) throw new Error("book_corrupt");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = plainObject(item);
    const code = record && typeof record.code === "string" ? record.code : "";
    const shares = record ? record.shares : null;
    const updatedAt = record && typeof record.updatedAt === "string" ? record.updatedAt : "";
    if (!/^\d{6}$/.test(code) || seen.has(code)) throw new Error("book_corrupt");
    if (typeof shares !== "number" || !Number.isSafeInteger(shares) || shares < 1 || shares > 1_000_000_000) {
      throw new Error("book_corrupt");
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt)) throw new Error("book_corrupt");
    seen.add(code);
    return { code, shares, updatedAt };
  });
}

export function parseBookDocument(value: unknown): BookDocument {
  if (typeof value !== "string" || value.trim() === "") throw new Error("book_corrupt");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("book_corrupt");
  }
  const record = plainObject(parsed);
  if (!record) throw new Error("book_corrupt");
  const items = parseItems(record.items);
  const appliesRaw = plainObject(record.applies);
  const draftsRaw = plainObject(record.drafts);
  if (!appliesRaw || !draftsRaw || !Array.isArray(record.attempts)) throw new Error("book_corrupt");
  const applies: BookDocument["applies"] = {};
  for (const [key, entry] of Object.entries(appliesRaw)) {
    const apply = plainObject(entry);
    const hash = apply && typeof apply.hash === "string" ? apply.hash : "";
    const applyExpires = apply && typeof apply.expiresAt === "string" ? apply.expiresAt : "";
    if (!/^op\.v1\.\d{13}\.[0-9a-f-]{36}$/i.test(key) || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error("book_corrupt");
    }
    if (Number.isNaN(Date.parse(applyExpires))) throw new Error("book_corrupt");
    applies[key] = { hash, expiresAt: applyExpires, items: parseItems(apply?.items) };
  }
  const drafts: BookDocument["drafts"] = {};
  for (const [id, entry] of Object.entries(draftsRaw)) {
    const draft = plainObject(entry);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !draft || typeof draft.payload !== "string") {
      throw new Error("book_corrupt");
    }
    const draftExpires = typeof draft.expiresAt === "string" ? draft.expiresAt : "";
    if (Number.isNaN(Date.parse(draftExpires))) throw new Error("book_corrupt");
    const consumedBy = draft.consumedBy;
    if (consumedBy !== null && typeof consumedBy !== "string") throw new Error("book_corrupt");
    drafts[id] = { payload: draft.payload, expiresAt: draftExpires, consumedBy };
  }
  const attempts = record.attempts.map((entry) => {
    const attempt = plainObject(entry);
    const id = attempt && typeof attempt.id === "string" ? attempt.id : "";
    const at = attempt && typeof attempt.at === "string" ? attempt.at : "";
    const status = attemptStatus(attempt && typeof attempt.status === "string" ? attempt.status : "");
    if (!id || Number.isNaN(Date.parse(at))) throw new Error("book_corrupt");
    return { id, at, status };
  });
  return { items, applies, drafts, attempts };
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
  const version = parseVersion(row.version);
  return { version, doc: parseBookDocument(row.document) };
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
