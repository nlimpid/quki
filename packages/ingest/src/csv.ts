import type { DailyBar } from "@quki/types";

/** Seed/API row before numeric conversion. Strings preserve CSV scale. */
export type SeedBar = {
  date: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  volume: string | null;
  amount: string | null;
  preClose?: string | null;
  changePct?: string | null;
};

export function parseSeedCsv(text: string): SeedBar[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLine = lines[0];
  if (!headerLine) return [];
  const header = headerLine.split(",").map((cell) => cell.trim());
  const index = new Map(header.map((name, i) => [name, i]));
  const rows: SeedBar[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const cell = (name: string): string | null => {
      const at = index.get(name);
      if (at == null) return null;
      const value = cells[at]?.trim() ?? "";
      return value === "" ? null : value;
    };
    const date = cell("date");
    const close = cell("close");
    if (!date || !close) continue;
    rows.push({
      date,
      open: cell("open"),
      high: cell("high"),
      low: cell("low"),
      close,
      volume: cell("volume"),
      amount: cell("amount"),
    });
  }
  return rows;
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function seedToDaily(rows: readonly SeedBar[]): DailyBar[] {
  const bars: DailyBar[] = [];
  for (const row of rows) {
    const close = num(row.close);
    if (close == null) continue;
    bars.push({
      date: row.date,
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      close,
      volume: num(row.volume),
      amount: num(row.amount),
    });
  }
  return bars;
}

export function formatDecimal(value: number | null, scale: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(scale);
}
