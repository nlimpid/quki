/** Canonical parameters for the phase-1 MA55 study. Hash travels with stored rows. */

export const MA55_PARAMS = {
  window: 55,
  neighborWeeks: 13,
  lowThreshold: 0.95,
  percentile: "expanding_strictly_below",
  week: "iso-monday",
  lowFallback: "close",
} as const;

export type Ma55Params = typeof MA55_PARAMS;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, inner]) => [key, sortValue(inner)]));
  }
  return value;
}

export function canonicalParams(params: unknown = MA55_PARAMS): string {
  return JSON.stringify(sortValue(params));
}

export async function paramsHash(params: unknown = MA55_PARAMS): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalParams(params));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
