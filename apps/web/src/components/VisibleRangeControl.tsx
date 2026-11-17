import { Button, Slider } from "@heroui/react";

const THUMB_LABELS = ["可见区间起点", "可见区间终点"] as const;

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
  return (
    <div className="range-control">
      <Slider
        aria-label="可见区间"
        className="range-slider"
        minValue={0}
        maxValue={max}
        step={1}
        value={[start, end]}
        onChange={(next) => {
          if (!Array.isArray(next) || next.length < 2) return;
          const [fromValue, toValue] = next;
          if (fromValue == null || toValue == null || toValue <= fromValue) return;
          onChange(fromValue, toValue);
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
