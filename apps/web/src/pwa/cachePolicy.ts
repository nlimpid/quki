/** Static files the worker may keep. Nothing here is an account, quote, or session. */
export const PWA_CACHE_PREFIX = "quki-pwa-";
export const PWA_CACHE_NAME = "quki-pwa-static-v1";

export const PRECACHE_PATHS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
] as const;

export type FetchPlan = "network-only" | "precache" | "navigation-or-offline";

const PRIVATE_PATH_PREFIXES = ["/api/auth", "/api/account", "/api/holdings", "/api/"];

function isClerkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "clerk.com" || host.endsWith(".clerk.com") || host.endsWith(".clerk.accounts.dev") || host === "clerk.quki.cc" || host.endsWith(".clerk.quki.cc");
}

/**
 * Decide whether a request may touch the owned static cache.
 * Authentication, account, holdings, and any other API stay on the network.
 */
export function planFetch(input: { url: string; method: string; mode?: string }): FetchPlan {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return "network-only";
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return "network-only";
  }
  if (isClerkHost(url.hostname)) return "network-only";
  const path = url.pathname.toLowerCase();
  if (PRIVATE_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) {
    return "network-only";
  }
  if (path.startsWith("/api")) return "network-only";
  if ((PRECACHE_PATHS as readonly string[]).includes(path)) return "precache";
  if (input.mode === "navigate") return "navigation-or-offline";
  return "network-only";
}

export function ownedCacheNamesToDelete(existing: readonly string[], current = PWA_CACHE_NAME): string[] {
  return existing.filter((name) => name.startsWith(PWA_CACHE_PREFIX) && name !== current);
}
