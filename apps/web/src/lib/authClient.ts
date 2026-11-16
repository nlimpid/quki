import { parseAuthSessionResponse, type AuthSessionResponse } from "@quki/types";

export async function fetchSession(fetchImpl: typeof fetch = fetch): Promise<AuthSessionResponse> {
  const response = await fetchImpl("/api/auth/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("session_unavailable");
  const parsed = parseAuthSessionResponse(await response.json().catch(() => null));
  if (!parsed) throw new Error("session_unavailable");
  return parsed;
}

export async function logoutSession(
  csrfToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ csrf: csrfToken }),
  });
  if (!response.ok) throw new Error("logout_failed");
}
