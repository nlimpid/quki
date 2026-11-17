/** Visible window for the time scale. Gestures still work; this control is separate from them. */
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
  const end = clamp(Math.round(to), 0, max);
  return (
    <div className="range-control">
      <span className="range-control-label">可见区间</span>
      <label>
        起点
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={start}
          aria-label="可见区间起点"
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange(next, Math.max(next + 1, end));
          }}
        />
      </label>
      <label>
        终点
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={end}
          aria-label="可见区间终点"
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange(Math.min(start, next - 1), next);
          }}
        />
      </label>
      <button type="button" className="range-reset" onClick={onReset}>
        显示全部
      </button>
      <span className="qk-tabular">
        {start + 1}–{Math.max(start + 1, end + 1)} / {last + 1}
      </span>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
