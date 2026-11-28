import { isShanghaiTradingDay, previousTradingDay, shanghaiClock } from "./freshness.js";

/**
 * Session an incremental CSIndex fetch must already contain.
 * This is not health `expectedSession`. Health waits until 18:30 before it
 * expects today, so a 16:30 or 18:00 crawl is not an alert. The fetch still
 * has to ask for today's print once today is a trading day, including before
 * that grace. A missing target is partial, not success.
 *
 * Trading day, any clock: today.
 * Weekend, holiday, or any other closed day: the previous trading day.
 * Monday before the open therefore targets Monday, not Friday.
 */
export function fetchTargetSession(now: Date): string {
  const { date } = shanghaiClock(now);
  if (isShanghaiTradingDay(date)) return date;
  return previousTradingDay(date);
}
