import {
  IMAGE_PROCESS_CONSENT,
  IMAGE_PROCESS_DISCLOSURE,
  buildDividendReference,
  confirmImportRows,
  reviewVisionRows,
  validShareCount,
  type CashCoverage,
  type ImportConfirmation,
  type ReviewedVisionRow,
} from "@quki/analytics";
import { issueOperationToken, type BookCommit, type HoldingCashQuote, type HoldingsStore } from "@quki/db";
import type { Context, Hono } from "hono";

import type { AuthRuntime } from "../auth/runtime.js";
import { readCookie, SESSION_COOKIE } from "../auth/cookies.js";
import { secretsEqual, sha256Hex } from "../auth/crypto.js";
import { decodeImage, IMAGE_MAX_BYTES } from "./image.js";
import type { VisionExtractor } from "./vision.js";

const MAX_LINES = 50;
const DRAFT_TTL_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonBodies = new WeakMap<Request, Record<string, unknown>>();

export type HoldingsRuntime = {
  now: () => Date;
  store: HoldingsStore | null;
  quotes: (codes: readonly string[]) => Promise<HoldingCashQuote[]>;
  vision: VisionExtractor | null;
  visionTimeoutMs: number;
  previewLimit: number;
  previewWindowMs: number;
};

export function unconfiguredHoldings(): HoldingsRuntime {
  return {
    now: () => new Date(),
    store: null,
    quotes: async () => [],
    vision: null,
    visionTimeoutMs: 8_000,
    previewLimit: 5,
    previewWindowMs: 10 * 60 * 1000,
  };
}

type SessionUser = { id: string; csrfToken: string };

export function mountHoldingsRoutes(app: Hono, auth: AuthRuntime, holdings: HoldingsRuntime): void {
  app.get("/api/holdings", async (c) => {
    const user = await requireSession(c, auth);
    if (user instanceof Response) return user;
    const store = holdings.store;
    if (!store) return unavailable(c);
    try {
      const items = await store.list(user.id);
      const reference = buildDividendReference(await cover(holdings, items));
      return c.json({
        items,
        reference,
        visionConfigured: holdings.vision != null,
        imageDisclosure: IMAGE_PROCESS_DISCLOSURE,
        operationToken: issueOperationToken(holdings.now()),
      });
    } catch (error) {
      return storageFailed(c, error);
    }
  });

  app.post("/api/holdings", async (c) => {
    const user = await requireMutation(c, auth);
    if (user instanceof Response) return user;
    return writeLines(c, holdings, user.id, "replace");
  });

  app.post("/api/holdings/import", async (c) => {
    const user = await requireMutation(c, auth);
    if (user instanceof Response) return user;
    return writeLines(c, holdings, user.id, "set");
  });

  app.post("/api/holdings/preview", async (c) => {
    const user = await requireMutation(c, auth);
    if (user instanceof Response) return user;
    if (!holdings.vision) {
      return c.json({ error: "vision_not_configured", message: "识图尚未配置，图片不会上传" }, 503);
    }
    const store = holdings.store;
    if (!store) return unavailable(c);
    const fields = await readJson(c);
    if (fields.consent !== IMAGE_PROCESS_CONSENT) {
      return c.json({ error: "consent_required", message: "需要先同意把截图交给视觉服务" }, 400);
    }
    const mediaType =
      fields.mediaType === "image/png" || fields.mediaType === "image/jpeg" ? fields.mediaType : "";
    const encoded = typeof fields.imageBase64 === "string" ? fields.imageBase64 : "";
    if (!mediaType || encoded.length === 0 || encoded.includes("base64,")) {
      return c.json({ error: "image_type", message: "只接受 PNG 或 JPEG" }, 400);
    }
    let image: Uint8Array;
    try {
      image = decodeBase64(encoded);
      const decoded = await decodeImage(image, mediaType);
      const reservation = await store.reserveAttempt(
        user.id,
        holdings.now(),
        holdings.previewLimit,
        holdings.previewWindowMs,
      );
      if (reservation === "limited") {
        return c.json({ error: "rate_limited", message: "识图过于频繁，请稍后再试" }, 429);
      }
      if (reservation === "busy") return unavailable(c);
      let extracted: Awaited<ReturnType<NonNullable<HoldingsRuntime["vision"]>["extract"]>>;
      try {
        extracted = await withTimeout(
          holdings.vision.extract({
            mediaType: decoded.mediaType,
            byteLength: image.byteLength,
            bytes: image,
          }),
          holdings.visionTimeoutMs,
        );
      } catch (error) {
        await store.finishAttempt(user.id, reservation.id, "failed");
        throw error;
      }
      await store.finishAttempt(user.id, reservation.id, "finished");
      const quotes = await holdings.quotes(
        extracted.rows.flatMap((row) => (row.code && /^\d{6}$/.test(row.code) ? [row.code] : [])),
      );
      const reviewed = reviewVisionRows(extracted.rows, catalogOf(quotes));
      const payloadJson = JSON.stringify(reviewed);
      if (new TextEncoder().encode(payloadJson).byteLength > 8000) {
        return c.json({ error: "preview_too_large", message: "识别结果过长" }, 413);
      }
      const draftId = crypto.randomUUID();
      const now = holdings.now();
      await store.insertDraft({
        id: draftId,
        userId: user.id,
        payloadJson,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
        now,
      });
      return c.json({
        draftId,
        rows: reviewed,
        sourceRows: extracted.rows,
        catalog: quotes.map((quote) => ({ code: quote.code, name: quote.name })),
        imageDisclosure: IMAGE_PROCESS_DISCLOSURE,
        pixels: decoded.pixels,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "image_bytes")
        return c.json({ error: "image_bytes", message: "图片超过大小限制" }, 413);
      if (code.startsWith("image_"))
        return c.json({ error: code, message: "无法确认这是一张合格的图片" }, 400);
      if (code === "vision_timeout")
        return c.json({ error: "vision_timeout", message: "识图超时，图片未保存" }, 504);
      if (code === "window_full")
        return c.json(
          {
            error: "window_full",
            message:
              "这 10 分钟内已有 2 份未过期的识图草稿。账户股数没有改，已有草稿还在。请等一份超过 10 分钟后再生成。清空账户不会腾出次数。",
          },
          409,
        );
      return storageFailed(c, error);
    }
  });

  app.post("/api/holdings/apply", async (c) => {
    const user = await requireMutation(c, auth);
    if (user instanceof Response) return user;
    const store = holdings.store;
    if (!store) return unavailable(c);
    const fields = await readJson(c);
    const draftId = typeof fields.draftId === "string" ? fields.draftId : "";
    const key = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
    const submitted = parseConfirmations(fields.rows);
    if (!UUID_RE.test(draftId) || key.length === 0 || !submitted) {
      return c.json({ error: "bad_request", message: "确认内容无效" }, 400);
    }
    try {
      const now = holdings.now();
      const draft = await store.readDraft(user.id, draftId, now);
      if (draft === "missing")
        return c.json({ error: "draft_missing", message: "没有这份预览" }, 404);
      if (draft === "expired")
        return c.json({ error: "draft_used", message: "这份预览已经用过" }, 409);
      const reviewed = draft === "used" ? [] : parseReviewed(draft.payloadJson);
      if (!reviewed) return c.json({ error: "draft_missing", message: "没有这份预览" }, 404);
      const quotes = await holdings.quotes(submitted.map((row) => row.code));
      const confirmed =
        draft === "used"
          ? { ok: true as const, lines: submitted.map((row) => ({ code: row.code, shares: row.shares })) }
          : confirmImportRows(reviewed, submitted, catalogOf(quotes));
      if (!confirmed.ok)
        return c.json({ error: confirmed.error, message: "还有待核对的识别结果" }, 400);
      const lines = confirmed.lines.map((line) => ({ ...line, updatedAt: now.toISOString() }));
      const result = await store.commit({
        userId: user.id,
        key,
        hash: await payloadHash("apply", lines),
        mode: "apply",
        lines,
        draftId,
        now,
      });
      return commitResponse(c, holdings, result, "set");
    } catch (error) {
      return storageFailed(c, error);
    }
  });
}

async function writeLines(
  c: Context,
  holdings: HoldingsRuntime,
  userId: string,
  mode: "replace" | "set",
): Promise<Response> {
  const store = holdings.store;
  if (!store) return unavailable(c);
  const fields = await readJson(c);
  const key = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
  const parsed = parseLines(fields.items);
  if (key.length === 0 || !parsed)
    return c.json({ error: "bad_request", message: "持仓内容无效" }, 400);
  if (mode === "replace" && parsed.length === 0 && fields.confirmEmpty !== true) {
    return c.json({ error: "confirm_empty", message: "清空账户持仓需要明确确认" }, 400);
  }
  try {
    const now = holdings.now();
    const lines = parsed.map((line) => ({ ...line, updatedAt: now.toISOString() }));
    const result = await store.commit({
      userId,
      key,
      hash: await payloadHash(mode, lines),
      mode,
      lines,
      now,
    });
    return commitResponse(c, holdings, result, mode);
  } catch (error) {
    return storageFailed(c, error);
  }
}

function commitResponse(
  c: Context,
  holdings: HoldingsRuntime,
  result: BookCommit,
  mode: "replace" | "set",
): Promise<Response> | Response {
  if (result.outcome === "conflict")
    return c.json({ error: "idempotency_conflict", message: "重复提交的内容不一致" }, 409);
  if (result.outcome === "draft_missing")
    return c.json({ error: "draft_missing", message: "没有这份预览" }, 404);
  if (result.outcome === "draft_used" || result.outcome === "draft_expired")
    return c.json({ error: "draft_used", message: "这份预览已经用过" }, 409);
  if (result.outcome === "expired" || result.outcome === "malformed_key" || result.outcome === "window_full") {
    return c.json(operationRefusal(result.outcome), 409);
  }
  if (result.outcome === "busy")
    return c.json({ error: "storage_error", message: "账户持仓暂不可用" }, 503);
  if (result.outcome !== "written" && result.outcome !== "replay")
    return c.json({ error: "storage_error", message: "账户持仓暂不可用" }, 503);
  const items = result.items;
  return cover(holdings, items).then((covered) =>
    c.json({
      items,
      reference: buildDividendReference(covered),
      ...(result.outcome === "replay" ? { replayed: true } : { applied: mode }),
      operationToken: issueOperationToken(holdings.now()),
    }),
  );
}

function operationRefusal(outcome: "expired" | "malformed_key" | "window_full"): {
  error: string;
  message: string;
} {
  if (outcome === "window_full") {
    return {
      error: outcome,
      message:
        "这 10 分钟内已有 4 次保存，清空也算一次。账户股数没有改。请等较早的一次超过 10 分钟后再保存。清空账户不会腾出次数。",
    };
  }
  if (outcome === "expired") {
    return {
      error: outcome,
      message:
        "这个操作编号已超过服务器时钟上的 10 分钟。账户股数没有改。只有原来的整段编号可以重放；新的编号是另一次保存。",
    };
  }
  return {
    error: outcome,
    message:
      "操作编号不是 op.v1.时间戳.uuid，或时间比服务器时钟超前超过 60 秒。账户股数没有改。",
  };
}

async function payloadHash(
  mode: string,
  lines: readonly { code: string; shares: number }[],
): Promise<string> {
  const body = lines
    .map((line) => `${line.code}:${line.shares}`)
    .sort()
    .join("\n");
  return sha256Hex(`${mode}\n${body}`);
}

async function cover(
  holdings: HoldingsRuntime,
  items: readonly { code: string; shares: number }[],
): Promise<CashCoverage[]> {
  const quotes = await holdings.quotes(items.map((item) => item.code));
  const byCode = new Map(quotes.map((quote) => [quote.code, quote]));
  return items.map((item) => {
    const quote = byCode.get(item.code);
    return {
      code: item.code,
      name: quote?.name ?? null,
      shares: item.shares,
      ttmCashPerShare: quote?.ttmCashPerShare ?? null,
      yieldAsOf: quote?.yieldAsOf ?? null,
    };
  });
}

function catalogOf(quotes: readonly HoldingCashQuote[]): Map<string, string> {
  return new Map(quotes.map((quote) => [quote.code, quote.name]));
}

function parseLines(value: unknown): { code: string; shares: number }[] | null {
  if (!Array.isArray(value) || value.length > MAX_LINES) return null;
  const seen = new Set<string>();
  const lines: { code: string; shares: number }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const code = "code" in item && typeof item.code === "string" ? item.code : "";
    const shares = "shares" in item ? validShareCount(item.shares) : null;
    if (!/^\d{6}$/.test(code) || shares == null || seen.has(code)) return null;
    seen.add(code);
    lines.push({ code, shares });
  }
  return lines;
}

function parseConfirmations(value: unknown): ImportConfirmation[] | null {
  if (!Array.isArray(value) || value.length > MAX_LINES) return null;
  const rows: ImportConfirmation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const code = "code" in item && typeof item.code === "string" ? item.code : "";
    const shares = "shares" in item ? validShareCount(item.shares) : null;
    if (!/^\d{6}$/.test(code) || shares == null) return null;
    rows.push({
      code,
      shares,
      nameConfirmed: "nameConfirmed" in item && item.nameConfirmed === true,
      unknownConfirmed: "unknownConfirmed" in item && item.unknownConfirmed === true,
      sharesConfirmed: "sharesConfirmed" in item && item.sharesConfirmed === true,
    });
  }
  return rows;
}

function parseReviewed(payload: string): ReviewedVisionRow[] | null {
  try {
    const value = JSON.parse(payload) as unknown;
    if (!Array.isArray(value)) return null;
    return value as ReviewedVisionRow[];
  } catch {
    return null;
  }
}

async function requireSession(c: Context, auth: AuthRuntime): Promise<SessionUser | Response> {
  c.header("cache-control", "no-store");
  const token = readCookie(c, SESSION_COOKIE);
  if (!token || !auth.store) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  try {
    const lookup = await auth.store.findSession(await sha256Hex(token), auth.now());
    if (lookup.state !== "valid")
      return c.json({ error: "unauthorized", message: "需要登录" }, 401);
    return { id: lookup.user.id, csrfToken: lookup.csrfToken };
  } catch (error) {
    return storageFailed(c, error);
  }
}

async function requireMutation(c: Context, auth: AuthRuntime): Promise<SessionUser | Response> {
  const user = await requireSession(c, auth);
  if (user instanceof Response) return user;
  if (!sameOrigin(c.req.raw)) return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
  const fields = await readJson(c);
  const header = c.req.header("x-csrf-token") ?? "";
  const body = typeof fields.csrf === "string" ? fields.csrf : "";
  const csrf = header && body && header !== body ? "" : header || body;
  if (!csrf || !(await secretsEqual(csrf, user.csrfToken))) {
    return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
  }
  return user;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const cached = jsonBodies.get(c.req.raw);
  if (cached) return cached;
  const value = await c.req.json<unknown>().catch(() => null);
  const fields =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  jsonBodies.set(c.req.raw, fields);
  return fields;
}

function decodeBase64(value: string): Uint8Array {
  const maxChars = Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 8;
  if (value.length > maxChars) throw new Error("image_bytes");
  const binary = atob(value);
  if (binary.length > IMAGE_MAX_BYTES) throw new Error("image_bytes");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("vision_timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function unavailable(c: Context): Response {
  c.header("cache-control", "no-store");
  return c.json({ error: "storage_unconfigured", message: "账户持仓尚未配置" }, 503);
}

function storageFailed(c: Context, error: unknown): Response {
  void error;
  console.error("holdings_storage_failed");
  c.header("cache-control", "no-store");
  return c.json({ error: "storage_error", message: "账户持仓暂不可用" }, 503);
}
