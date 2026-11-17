import { parseAuthSessionResponse, type AuthSessionResponse } from "@quki/types";

/**
 * Keep a token only for the Clerk user id that started the read.
 * Compare that id with the id observed after `getToken()` resolves.
 * The ref is updated in an effect, so reading it before the await still
 * sees the previous user and must not be the expected id.
 */
export function bearerForUser(
  startedUserId: string | null,
  currentUserId: string | null | undefined,
  token: string | null | undefined,
): string | null {
  if (!startedUserId || startedUserId !== currentUserId) return null;
  if (!token) return null;
  return token;
}

export function bearerHeader(token: string | null | undefined): Record<string, string> {
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

export class SessionRejectedError extends Error {
  constructor() {
    super("session_rejected");
    this.name = "SessionRejectedError";
  }
}

export async function fetchSession(
  fetchImpl: typeof fetch = fetch,
  token?: string | null,
  signal?: AbortSignal,
): Promise<AuthSessionResponse> {
  const response = await fetchImpl("/api/auth/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { accept: "application/json", ...bearerHeader(token) },
  });
  if (response.status === 401) throw new SessionRejectedError();
  if (!response.ok) throw new Error("session_unavailable");
  const parsed = parseAuthSessionResponse(await response.json().catch(() => null));
  if (!parsed) throw new Error("session_unavailable");
  return parsed;
}

export async function logoutSession(
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!token) throw new Error("logout_failed");
  const response = await fetchImpl("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", ...bearerHeader(token) },
  });
  if (!response.ok) throw new Error("logout_failed");
}
