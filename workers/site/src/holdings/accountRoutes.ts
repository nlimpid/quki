import {
  HoldingTableMissing,
  IdentityTableMissing,
  validHoldingShares,
  validHoldingVersion,
  type HoldingStore,
} from "@quki/db";
import type { Context, Hono } from "hono";

import { bearerFromAuthorization, verifyClerkSessionToken } from "../auth/clerkVerify.js";
import type { AuthRuntime } from "../auth/runtime.js";

const UNAVAILABLE = {
  error: "holdings_unavailable",
  message: "账户持仓尚未开通，没有写入任何持仓。",
} as const;

function isHoldingBody(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function mutationFields(
  c: Context,
  pathCode: string | null,
): Promise<Record<string, unknown> | Response> {
  const parsed: unknown = await c.req.json().catch(() => null);
  if (!isHoldingBody(parsed) || "items" in parsed) {
    return c.json({ error: "invalid_holding", message: "不能用整表替换账户持仓。" }, 400);
  }
  const fields = parsed;
  const version = fields.expectedVersion;
  if (c.req.method === "DELETE" && !validHoldingVersion(version)) {
    return c.json({ error: "invalid_holding", message: "缺少持仓版本。" }, 400);
  }
  if (c.req.method === "PUT" && version !== null && !validHoldingVersion(version)) {
    return c.json({ error: "invalid_holding", message: "缺少持仓版本。" }, 400);
  }
  if (c.req.method === "DELETE" && !pathCode) {
    return c.json({ error: "invalid_holding", message: "股票代码不正确。" }, 400);
  }
  if (c.req.method === "PUT") {
    const code = pathCode ?? fields.code;
    if (pathCode && fields.code != null && fields.code !== pathCode) {
      return c.json({ error: "invalid_holding", message: "股票代码不正确。" }, 400);
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return c.json({ error: "invalid_holding", message: "股票代码不正确。" }, 400);
    }
    if (!validHoldingShares(fields.shares)) {
      return c.json(
        { error: "invalid_holding", message: "股数必须是 1 到 1000000000 的整数。" },
        400,
      );
    }
  }
  if (pathCode && !/^\d{6}$/.test(pathCode)) {
    return c.json({ error: "invalid_holding", message: "股票代码不正确。" }, 400);
  }
  return fields;
}

function noStore(c: { header: (name: string, value: string) => void }): void {
  c.header("cache-control", "no-store");
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

/** Session-scoped account rows. A missing store or a missing table writes nothing. */
export function mountAccountHoldingRoutes(app: Hono, auth: AuthRuntime): void {
  app.on(["GET", "PUT", "DELETE"], "/api/holdings", async (c) => {
    return handle(c, auth, null);
  });
  app.on(["PUT", "DELETE"], "/api/holdings/:code", async (c) => {
    return handle(c, auth, c.req.param("code"));
  });
}

async function handle(c: Context, auth: AuthRuntime, pathCode: string | null): Promise<Response> {
  noStore(c);
  if (c.req.method !== "GET" && !sameOrigin(c.req.raw)) {
    return c.json({ error: "forbidden", message: "请求来源不被接受" }, 403);
  }
  const bearer = bearerFromAuthorization(c.req.header("authorization"));
  if (!bearer) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  if (!auth.clerk || !auth.identities) {
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
  const verified = await verifyClerkSessionToken(bearer, auth.clerk);
  if (!verified.ok) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  let fields: Record<string, unknown> | null = null;
  if (c.req.method !== "GET") {
    const parsed = await mutationFields(c, pathCode);
    if (parsed instanceof Response) return parsed;
    fields = parsed;
  }
  let userId = "";
  try {
    userId = await auth.identities.resolve(verified.issuer, verified.subject, auth.now());
  } catch (error) {
    if (error instanceof IdentityTableMissing) return c.json(UNAVAILABLE, 503);
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
  if (!auth.holdings) return c.json(UNAVAILABLE, 503);
  return dispatch(c, auth.holdings, userId, pathCode, fields, auth.now());
}

async function dispatch(
  c: Context,
  store: HoldingStore,
  userId: string,
  pathCode: string | null,
  fields: Record<string, unknown> | null,
  now: Date,
): Promise<Response> {
  try {
    if (c.req.method === "GET") return c.json({ items: await store.list(userId) });
    if (!fields)
      return c.json({ error: "invalid_holding", message: "不能用整表替换账户持仓。" }, 400);
    if (c.req.method === "DELETE") {
      const removed = await store.remove({
        userId,
        code: pathCode ?? "",
        expectedVersion: String(fields.expectedVersion),
      });
      if (!removed.ok) {
        return c.json(
          { error: "version_conflict", message: "持仓已变化，请重新读取后再保存。" },
          409,
        );
      }
      return c.body(null, 204);
    }
    const code = String(pathCode ?? fields.code);
    const shares = fields.shares as number;
    const outcome =
      fields.expectedVersion == null
        ? await store.create({ userId, code, shares, now })
        : await store.update({
            userId,
            code,
            shares,
            expectedVersion: String(fields.expectedVersion),
            now,
          });
    if (!outcome.ok && outcome.reason === "unknown_code") {
      return c.json({ error: "unknown_code", message: "股票不在上市名录里。" }, 404);
    }
    if (!outcome.ok) {
      return c.json(
        { error: "version_conflict", message: "持仓已变化，请重新读取后再保存。" },
        409,
      );
    }
    return c.json(outcome.row);
  } catch (error) {
    if (error instanceof HoldingTableMissing) return c.json(UNAVAILABLE, 503);
    console.error("account_holding_failed");
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
}
