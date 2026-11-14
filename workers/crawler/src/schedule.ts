/**
 * Cloudflare Workers cron is Quartz, not Unix. Weekdays are 1 = Sunday
 * through 7 = Saturday. `1-5` is Sunday–Thursday and does not run on Friday.
 * `MON-FRI` is Monday–Friday. See
 * https://developers.cloudflare.com/workers/configuration/cron-triggers/
 */
export const WEEKDAY_CRONS = ["30 8 * * MON-FRI", "0 10 * * MON-FRI", "30 12 * * MON-FRI"] as const;

/** 20:30 Asia/Shanghai. Runs the incremental only when the session is still stale. */
export const CATCH_UP_CRON = WEEKDAY_CRONS[2];

export function isCatchUpCron(cron: string): boolean {
  const parts = cron.trim().toLowerCase().split(/\s+/);
  return parts[0] === "30" && parts[1] === "12";
}

/** Primary slots always ingest. The 20:30 slot ingests only when freshness is missing or stale. */
export function scheduledIngest(cron: string, stale: boolean | null): boolean {
  if (!isCatchUpCron(cron)) return true;
  return stale !== false;
}
