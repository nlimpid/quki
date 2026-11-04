import type { RangeKey, TierLevel, TierRow } from "@quki/types";

const levelFormat = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

export function formatLevel(value: number): string {
  return levelFormat.format(value);
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatPercentile(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatDistance(value: number): string {
  const abs = Math.abs(value).toFixed(1);
  if (value > 0) return `+${abs}%`;
  if (value < 0) return `−${abs}%`;
  return `${abs}%`;
}

export function formatVolume(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
  return levelFormat.format(value);
}

export function formatAsOf(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : iso.slice(0, 16);
}

export function positionZone(ratioPct: number): {
  label: string;
  variant: "epic" | "important" | "neutral";
} {
  if (ratioPct < 85) return { label: "史诗底", variant: "epic" };
  if (ratioPct < 90) return { label: "重要底", variant: "important" };
  if (ratioPct < 95) return { label: "偏低 · 近重要底", variant: "important" };
  if (ratioPct < 105) return { label: "中性", variant: "neutral" };
  return { label: "偏高", variant: "neutral" };
}

/** Band ceiling: smallest tier whose level is still at or above the close. */
export function ceilingTier(rows: readonly TierRow[], lastClose: number): TierLevel {
  return rows.find((row) => row.level >= lastClose)?.tier ?? rows[rows.length - 1]?.tier ?? 100;
}

const RANGE_YEARS: Record<Exclude<RangeKey, "MAX">, number> = {
  "1Y": 1,
  "3Y": 3,
  "5Y": 5,
  "10Y": 10,
};

export function rangeStart(asOfDate: string, range: RangeKey): string | null {
  if (range === "MAX") return null;
  const date = new Date(`${asOfDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - RANGE_YEARS[range]);
  return date.toISOString().slice(0, 10);
}
