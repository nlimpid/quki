import { PHASE1_INSTRUMENTS, type Period, type RangeKey } from "@quki/types";

import { formatAsOf } from "../lib/format.js";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "1Y", label: "1年" },
  { value: "3Y", label: "3年" },
  { value: "5Y", label: "5年" },
  { value: "10Y", label: "10年" },
  { value: "MAX", label: "全部" },
];

export function Toolbar({
  code,
  period,
  range,
  asOf,
  loading,
  onCode,
  onPeriod,
  onRange,
}: {
  code: string;
  period: Period;
  range: RangeKey;
  asOf?: string;
  loading?: boolean;
  onCode: (code: string) => void;
  onPeriod: (period: Period) => void;
  onRange: (range: RangeKey) => void;
}) {
  return (
    <div className="toolbar">
      <div className="pills" role="tablist" aria-label="指数">
        {PHASE1_INSTRUMENTS.map((item) => (
          <button
            key={item.symbol}
            type="button"
            role="tab"
            aria-selected={item.symbol === code}
            className={item.symbol === code ? "pill active" : "pill"}
            onClick={() => onCode(item.symbol)}
            onKeyDown={(event) => {
              const index = PHASE1_INSTRUMENTS.findIndex((option) => option.symbol === item.symbol);
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next =
                  PHASE1_INSTRUMENTS[
                    (index + (event.key === "ArrowRight" ? 1 : PHASE1_INSTRUMENTS.length - 1)) %
                      PHASE1_INSTRUMENTS.length
                  ];
                if (next) onCode(next.symbol);
              }
            }}
          >
            {item.shortName}
            <span className="code">{item.symbol}</span>
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="周期">
        <button
          type="button"
          className={period === "D" ? "active" : ""}
          onClick={() => onPeriod("D")}
        >
          日
        </button>
        <button
          type="button"
          className={period === "W" ? "active" : ""}
          onClick={() => onPeriod("W")}
        >
          周
        </button>
      </div>
      <div className="seg" role="group" aria-label="区间">
        {RANGES.map((item) => (
          <button
            key={item.value}
            type="button"
            className={range === item.value ? "active" : ""}
            onClick={() => onRange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="asof">
        数据截至{" "}
        {loading ? (
          <span className="skeleton" style={{ display: "inline-block", width: 120, height: 14 }} />
        ) : (
          <strong className="qk-tabular">{asOf ? formatAsOf(asOf) : "—"}</strong>
        )}{" "}
        北京时间
      </div>
    </div>
  );
}
