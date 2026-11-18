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

export type AuthProbeOutcome =
  | { type: "ok"; session: AuthSessionResponse }
  | { type: "unavailable" }
  | { type: "rejected-unknown" };

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * One session read. A rejected bearer signs out, then this function itself
 * requests the session again with no token. It does not wait for a new Clerk
 * user id. Transport failures do not sign out and do not start that second read.
 */
export async function runAuthProbe(input: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  getAccessToken?: () => Promise<string | null>;
  onSessionRejected?: () => Promise<void>;
}): Promise<AuthProbeOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let token: string | null = null;
  try {
    token = input.getAccessToken ? await input.getAccessToken() : null;
  } catch (error) {
    if (isAbort(error, input.signal)) throw error;
    return { type: "unavailable" };
  }
  try {
    return { type: "ok", session: await fetchSession(fetchImpl, token, input.signal) };
  } catch (error) {
    if (isAbort(error, input.signal)) throw error;
    if (!(error instanceof SessionRejectedError)) return { type: "unavailable" };
    if (!input.onSessionRejected) return { type: "rejected-unknown" };
    try {
      await input.onSessionRejected();
    } catch (clearError) {
      if (isAbort(clearError, input.signal)) throw clearError;
      return { type: "rejected-unknown" };
    }
    if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    try {
      return { type: "ok", session: await fetchSession(fetchImpl, null, input.signal) };
    } catch (follow) {
      if (isAbort(follow, input.signal)) throw follow;
      if (follow instanceof SessionRejectedError) return { type: "rejected-unknown" };
      return { type: "unavailable" };
    }
  }
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
