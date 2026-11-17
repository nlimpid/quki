import type { Context, Hono } from "hono";

import { readCookie, SESSION_COOKIE } from "../auth/cookies.js";
import { secretsEqual, sha256Hex } from "../auth/crypto.js";
import type { AuthRuntime } from "../auth/runtime.js";

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

/** Session check only. There is no holdings table wired here, so a signed-in request cannot be stored. */
export function mountAccountHoldingRoutes(app: Hono, auth: AuthRuntime): void {
  app.on(["GET", "PUT", "DELETE"], "/api/holdings", async (c) => {
    return refuse(c, auth);
  });
  app.on(["PUT", "DELETE"], "/api/holdings/:code", async (c) => {
    return refuse(c, auth);
  });
}

async function refuse(c: Context, auth: AuthRuntime): Promise<Response> {
  noStore(c);
  if (c.req.method !== "GET" && !sameOrigin(c.req.raw)) {
    return c.json({ error: "forbidden", message: "请求来源不被接受" }, 403);
  }
  const token = readCookie(c, SESSION_COOKIE);
  if (!token || !auth.store) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  try {
    const lookup = await auth.store.findSession(await sha256Hex(token), auth.now());
    if (lookup.state !== "valid")
      return c.json({ error: "unauthorized", message: "需要登录" }, 401);
    if (c.req.method !== "GET") {
      const header = c.req.header("x-csrf-token") ?? "";
      if (!header || !(await secretsEqual(header, lookup.csrfToken))) {
        return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
      }
      const fields = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!fields || Array.isArray(fields) || "items" in fields) {
        return c.json({ error: "invalid_holding", message: "不能用整表替换账户持仓。" }, 400);
      }
      const version = fields.expectedVersion;
      const rowVersion =
        typeof version === "number" && Number.isSafeInteger(version) && version >= 1;
      if (c.req.method === "DELETE" && !rowVersion) {
        return c.json({ error: "invalid_holding", message: "缺少持仓版本。" }, 400);
      }
      if (c.req.method === "PUT" && version !== null && !rowVersion) {
        return c.json({ error: "invalid_holding", message: "缺少持仓版本。" }, 400);
      }
      if (c.req.method === "PUT") {
        const shares = fields.shares;
        if (typeof fields.code !== "string" || !/^\d{6}$/.test(fields.code)) {
          return c.json({ error: "invalid_holding", message: "股票代码不正确。" }, 400);
        }
        if (
          typeof shares !== "number" ||
          !Number.isInteger(shares) ||
          shares < 1 ||
          shares > 1_000_000_000
        ) {
          return c.json(
            { error: "invalid_holding", message: "股数必须是 1 到 1000000000 的整数。" },
            400,
          );
        }
      }
    }
  } catch {
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
  return c.json(
    { error: "holdings_unavailable", message: "账户持仓尚未开通，没有写入任何持仓。" },
    503,
  );
}
