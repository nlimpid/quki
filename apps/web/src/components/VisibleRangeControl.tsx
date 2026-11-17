import { Button, Slider } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

const THUMB_LABELS = ["可见区间起点", "可见区间终点"] as const;
const THUMB_HIT = 40;

/** Keep a one-step window when a drag parks both thumbs on the same bar. */
export function boundedRange(
  next: readonly [number, number],
  previous: { start: number; end: number },
  max: number,
): [number, number] | null {
  const [rawStart, rawEnd] = next;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !Number.isFinite(max) || max < 1) {
    return null;
  }
  const start = clamp(Math.round(rawStart), 0, max);
  const end = clamp(Math.round(rawEnd), 0, max);
  if (end > start) return [start, end];
  if (start === previous.start) {
    const edge = Math.min(max, start + 1);
    return [edge - 1, edge];
  }
  const edge = Math.max(1, Math.min(max, end));
  return [edge - 1, edge];
}

/** Ignore sub-step chart echoes so a slider drag and a wheel/pan do not chase each other. */
export function nextVisibleWindow(
  previous: { from: number; to: number; last: number } | null,
  logical: { from: number; to: number },
  last: number,
) {
  if (
    previous &&
    previous.last === last &&
    Math.abs(previous.from - logical.from) < 0.05 &&
    Math.abs(previous.to - logical.to) < 0.05
  ) {
    return previous;
  }
  return { from: logical.from, to: logical.to, last };
}

export function rangeNeedsApply(
  current: { from: number; to: number } | null,
  from: number,
  to: number,
) {
  if (!current) return true;
  return Math.abs(current.from - from) >= 0.05 || Math.abs(current.to - to) >= 0.05;
}

/** One range slider for the visible window. Gestures still move the same time scale. */
export function VisibleRangeControl({
  from,
  to,
  last,
  onChange,
  onReset,
}: {
  from: number;
  to: number;
  last: number;
  onChange: (from: number, to: number) => void;
  onReset: () => void;
}) {
  const max = Math.max(1, last);
  const start = clamp(Math.round(from), 0, max);
  const end = clamp(Math.round(to), start + 1, max);
  const rootRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    const track = root?.querySelector(".slider__track");
    if (!track) return;
    const measure = () => setTrackWidth(track.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const gapPx = trackWidth > 0 ? ((end - start) / max) * trackWidth : Number.POSITIVE_INFINITY;
  const tight = gapPx < THUMB_HIT;
  return (
    <div className="range-control" data-tight={tight ? "true" : undefined} ref={rootRef}>
      <Slider
        aria-label="可见区间"
        className="range-slider"
        minValue={0}
        maxValue={max}
        step={1}
        value={[start, end]}
        onChange={(next) => {
          if (!Array.isArray(next) || next[0] == null || next[1] == null) return;
          const bounded = boundedRange([next[0], next[1]], { start, end }, max);
          if (!bounded) return;
          onChange(bounded[0], bounded[1]);
        }}
      >
        <Slider.Track>
          {({ state }) => (
            <>
              <Slider.Fill />
              {state.values.map((_, index) => (
                <Slider.Thumb
                  key={index}
                  aria-label={THUMB_LABELS[index] ?? `可见区间 ${index + 1}`}
                  className={index === 0 ? "range-thumb-start" : "range-thumb-end"}
                  index={index}
                />
              ))}
            </>
          )}
        </Slider.Track>
      </Slider>
      <span className="qk-tabular range-readout">
        {start + 1}–{end + 1} / {last + 1}
      </span>
      <Button size="sm" variant="secondary" onPress={onReset}>
        显示全部
      </Button>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
