import { describe, expect, it, vi } from "vitest";

import type { MarketFreshness } from "@quki/analytics";

import { postStaleAlert, staleAlertBody, type AlertFetch } from "./alert.js";
import { shouldAlertAfterCron } from "./schedule.js";

const stillThursday: MarketFreshness = {
  asOf: "2026-11-18T10:08:00.000Z",
  expectedSession: "2026-11-19",
  indexThrough: "2026-11-18",
  lastSuccess: { job: "cron_incremental", at: "2026-11-19T10:05:00.000Z" },
  quotesStale: true,
  indexStale: true,
  stale: true,
  alert: false,
  calendarKnown: true,
};

describe("stale alert", () => {
  it("does not page from the 16:30 or 18:00 slots", () => {
    expect(shouldAlertAfterCron("30 8 * * MON-FRI", stillThursday)).toBe(false);
    expect(shouldAlertAfterCron("0 10 * * MON-FRI", stillThursday)).toBe(false);
    expect(shouldAlertAfterCron("30 12 * * MON-FRI", stillThursday)).toBe(true);
    expect(shouldAlertAfterCron("30 12 * * MON-FRI", { ...stillThursday, stale: false })).toBe(
      false,
    );
  });

  it("posts one page after the retry when the session is still missing", async () => {
    const fetchImpl = vi.fn<AlertFetch>(async () => new Response("ok", { status: 200 }));
    const delivered = await postStaleAlert({
      webhookUrl: "https://hooks.example/quki",
      report: { ...stillThursday, alert: true },
      cron: "30 12 * * MON-FRI",
      fetchImpl,
    });
    expect(delivered).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.example/quki");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as ReturnType<typeof staleAlertBody>;
    expect(body.alert).toBe("stale_after_retry");
    expect(body.expectedSession).toBe("2026-11-19");
    expect(body.indexThrough).toBe("2026-11-18");
    expect(JSON.stringify(body)).not.toContain("mysql://");
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("does not pretend a missing webhook was delivered", async () => {
    const fetchImpl = vi.fn<AlertFetch>();
    const delivered = await postStaleAlert({
      webhookUrl: undefined,
      report: stillThursday,
      cron: "30 12 * * MON-FRI",
      fetchImpl,
    });
    expect(delivered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call the webhook for a fresh book", () => {
    const fresh = { ...stillThursday, stale: false, alert: false, indexThrough: "2026-11-19" };
    expect(fresh.stale).toBe(false);
    expect(staleAlertBody(fresh, "30 12 * * MON-FRI").indexThrough).toBe("2026-11-19");
  });
});
