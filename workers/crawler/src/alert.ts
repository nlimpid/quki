import type { MarketFreshness } from "@quki/analytics";

export const ALERT_WEBHOOK_ENV = "ALERT_WEBHOOK_URL";

export type AlertFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One stale-session page. No secrets, no database URL. */
export function staleAlertBody(report: MarketFreshness, cron: string): Record<string, unknown> {
  return {
    text: `quki data still stale after the 20:30 retry. Expected ${report.expectedSession}; index through ${report.indexThrough ?? "none"}; quotes ${report.quotesStale ? "stale" : "current"}.`,
    alert: "stale_after_retry",
    cron,
    expectedSession: report.expectedSession,
    indexThrough: report.indexThrough,
    asOf: report.asOf,
    quotesStale: report.quotesStale,
    indexStale: report.indexStale,
    lastSuccess: report.lastSuccess,
  };
}

/**
 * POST the stale page to `ALERT_WEBHOOK_URL`. A missing URL is a logged failure,
 * not a silent success: the cron already recorded `failed` before this runs.
 * Returns true only when the webhook answers 2xx.
 */
export async function postStaleAlert(input: {
  webhookUrl: string | undefined;
  report: MarketFreshness;
  cron: string;
  fetchImpl?: AlertFetch;
}): Promise<boolean> {
  const url = input.webhookUrl?.trim() ?? "";
  if (!url) {
    console.error(
      JSON.stringify({
        message: "stale after retry; alert webhook is not configured",
        env: ALERT_WEBHOOK_ENV,
        cron: input.cron,
        expectedSession: input.report.expectedSession,
      }),
    );
    return false;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = JSON.stringify(staleAlertBody(input.report, input.cron));
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(
        JSON.stringify({
          message: "stale alert webhook failed",
          status: response.status,
          cron: input.cron,
        }),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "stale alert webhook failed",
        error: error instanceof Error ? error.message : String(error),
        cron: input.cron,
      }),
    );
    return false;
  }
}
