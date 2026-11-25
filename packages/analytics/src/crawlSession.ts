import { fetchTargetSession } from "./fetchTarget.js";
import { expectedTradingSession, sessionCovers } from "./freshness.js";

/**
 * Incremental crawl outcome for one symbol.
 * Success requires the fetch target session, which on a trading day is today
 * even before the 18:30 health grace. `expectedSession` stays the health
 * clock and is not what this decision uses. A CSIndex 200 that omits the
 * target is `partial`: bars already returned are kept, but the run is not a
 * success. Backfill does not have to reach the target.
 */
export function crawlSessionStatus(input: {
  mode: "incremental" | "backfill";
  through: string | null;
  now: Date;
}): {
  status: "success" | "partial";
  sessionMissing: boolean;
  expectedSession: string;
  targetSession: string;
} {
  const expectedSession = expectedTradingSession(input.now);
  const targetSession = fetchTargetSession(input.now);
  const sessionMissing =
    input.mode === "incremental" && !sessionCovers(input.through, targetSession);
  return {
    status: sessionMissing ? "partial" : "success",
    sessionMissing,
    expectedSession,
    targetSession,
  };
}
