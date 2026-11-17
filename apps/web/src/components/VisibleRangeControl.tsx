import { Button, Slider } from "@heroui/react";

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
          if (!Array.isArray(next)) return;
          const [fromValue, toValue] = next;
          if (fromValue == null || toValue == null || toValue <= fromValue) return;
          onChange(fromValue, toValue);
        }}
      >
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb aria-label="可见区间起点" />
          <Slider.Thumb aria-label="可见区间终点" />
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
