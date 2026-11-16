import { parseAuthSessionResponse } from "@quki/types";
import { describe, expect, it } from "vitest";

import {
  LOGIN_UI_ENABLED,
  LOGIN_UNAVAILABLE_COPY,
  applyProbeFailure,
  applyProbeSuccess,
  headerControl,
  loginView,
  showLoginCta,
  type AuthPhase,
} from "../../../../apps/web/src/lib/authState.js";
import { fetchSession } from "../../../../apps/web/src/lib/authClient.js";
import worker, { type Env } from "../index.js";

const env: Env = {
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
};

function initializing(): AuthPhase {
  return { kind: "initializing", login: { state: "unknown" } };
}

describe("unconfigured worker session", () => {
  it("returns 200 with login unavailable and does not set a session cookie", async () => {
    const response = await worker.fetch(new Request("https://quki.cc/api/auth/session"), env);
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body).toEqual({
      status: "unavailable",
      authenticated: false,
      expired: false,
      user: null,
      csrfToken: null,
      login: { ready: false, method: null, reason: "auth_not_configured" },
    });
    const session = parseAuthSessionResponse(body);
    expect(session).not.toBeNull();
    if (!session) return;
    const phase = applyProbeSuccess(initializing(), session);
    expect(phase).toMatchObject({
      kind: "guest",
      expired: false,
      login: { state: "unavailable", reason: "auth_not_configured" },
    });
    expect(LOGIN_UI_ENABLED).toBe(false);
    expect(headerControl(phase)).toBe("none");
    expect(showLoginCta(phase)).toBe(false);
    expect(loginView(phase)).toMatchObject({
      mode: "unavailable",
      message: LOGIN_UNAVAILABLE_COPY,
      alert: null,
      retry: true,
    });

    const login = await worker.fetch(
      new Request("https://quki.cc/api/auth/login", { method: "POST" }),
      env,
    );
    expect(login.status).toBe(503);
    expect(await login.json()).toEqual({ error: "auth_unavailable", message: "登录尚未配置" });
    expect(login.headers.get("location")).toBeNull();
  });

  it("maps an HTTP 503 probe to unknown rather than login unavailable", async () => {
    await expect(
      fetchSession(
        async () => new Response(JSON.stringify({ error: "auth_unavailable" }), { status: 503 }),
      ),
    ).rejects.toThrow(/session_unavailable/);
    const phase = applyProbeFailure(initializing());
    expect(phase.kind).toBe("unknown");
    expect(headerControl(phase)).toBe("login");
    expect(showLoginCta(phase, false)).toBe(true);
    expect(loginView(phase).mode).toBe("check_failed");
    expect(loginView(phase).message).toBeNull();
  });
});
