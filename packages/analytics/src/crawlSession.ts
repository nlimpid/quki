import { expectedTradingSession, sessionCovers } from "./freshness.js";

/**
 * Incremental crawl outcome for one symbol.
 * A CSIndex 200 that only repeats the previous session is `partial`: the bars
 * are kept, but the run is not a success and must not clear freshness.
 */
export function crawlSessionStatus(input: {
  mode: "incremental" | "backfill";
  through: string | null;
  now: Date;
}): { status: "success" | "partial"; sessionMissing: boolean; expectedSession: string } {
  const expectedSession = expectedTradingSession(input.now);
  const sessionMissing =
    input.mode === "incremental" && !sessionCovers(input.through, expectedSession);
  return {
    status: sessionMissing ? "partial" : "success",
    sessionMissing,
    expectedSession,
  };
}
