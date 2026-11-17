/** Labeled sample bars for the Unovis proof. Not a market API response. */
export type SampleBar = {
  i: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function sampleOhlc(count = 80): SampleBar[] {
  const bars: SampleBar[] = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const drift = Math.sin(i / 7) * 1.4 + Math.cos(i / 3) * 0.6;
    const open = price;
    const close = Math.round((open + drift) * 100) / 100;
    const high = Math.round((Math.max(open, close) + 0.8 + (i % 5) * 0.15) * 100) / 100;
    const low = Math.round((Math.min(open, close) - 0.7 - (i % 4) * 0.1) * 100) / 100;
    bars.push({
      i,
      time: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: 800_000 + ((i * 37) % 50) * 20_000,
    });
    price = close;
  }
  return bars;
}
