import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

import { AUTH_OAUTH_MAX_AGE_SECONDS, AUTH_SESSION_MAX_AGE_SECONDS } from "@quki/types";

export const SESSION_COOKIE = "qk_session";
export const CSRF_COOKIE = "qk_csrf";
export const OAUTH_COOKIE = "qk_oauth";

const CSRF_MAX_AGE_SECONDS = 60 * 60;

function attributes(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}

export function readCookie(c: Context, name: string): string | undefined {
  const value = getCookie(c, name);
  return value && value.length > 0 ? value : undefined;
}

export function writeSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, attributes(AUTH_SESSION_MAX_AGE_SECONDS));
}

export function writeCsrfCookie(c: Context, token: string): void {
  setCookie(c, CSRF_COOKIE, token, attributes(CSRF_MAX_AGE_SECONDS));
}

export function writeOauthCookie(c: Context, token: string): void {
  setCookie(c, OAUTH_COOKIE, token, attributes(AUTH_OAUTH_MAX_AGE_SECONDS));
}

export function clearAuthCookie(c: Context, name: string): void {
  setCookie(c, name, "", attributes(0));
}
