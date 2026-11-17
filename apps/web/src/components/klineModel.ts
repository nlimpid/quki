import type { Candle } from "@quki/types";
import type { CandlestickData, LineData, WhitespaceData } from "lightweight-charts";

export type TimePoint = { time: string };

/** Candles with a full open/high/low, and close-only points. Missing OHLC is never invented. */
export function splitPriceSeries(candles: readonly Candle[]): {
  candles: (CandlestickData | WhitespaceData)[];
  closeOnly: (LineData | WhitespaceData)[];
} {
  const ohlc: (CandlestickData | WhitespaceData)[] = [];
  const closeOnly: (LineData | WhitespaceData)[] = [];
  for (const candle of candles) {
    const time = candle.time;
    if (candle.open != null && candle.high != null && candle.low != null) {
      ohlc.push({
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      closeOnly.push({ time });
    } else {
      ohlc.push({ time });
      closeOnly.push({ time, value: candle.close });
    }
  }
  return { candles: ohlc, closeOnly };
}

/** Volume bars follow the volume field alone. A missing volume is a gap, never a zero. */
export function volumeBars(
  candles: readonly {
    time: string;
    open: number | null;
    close: number;
    volume: number | null;
  }[],
  up: string,
  down: string,
): ({ time: string } | { time: string; value: number; color: string })[] {
  return candles.map((candle, index) => {
    if (candle.volume == null) return { time: candle.time };
    const previous = candles[index - 1]?.close ?? candle.open ?? candle.close;
    return {
      time: candle.time,
      value: candle.volume,
      color: candle.close >= previous ? up : down,
    };
  });
}

export function lineWithGaps(
  candles: readonly Candle[],
  values: readonly (number | null)[],
): (LineData | WhitespaceData)[] {
  return candles.map((candle, index) => {
    const value = values[index];
    return value == null ? { time: candle.time } : { time: candle.time, value };
  });
}
