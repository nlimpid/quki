import { PHASE1_INSTRUMENTS, type Period, type RangeKey } from "@quki/types";

import { FilterGroup } from "./FilterGroup.js";

const RANGES: { id: RangeKey; label: string }[] = [
  { id: "1Y", label: "1年" },
  { id: "3Y", label: "3年" },
  { id: "5Y", label: "5年" },
  { id: "10Y", label: "10年" },
  { id: "MAX", label: "全部" },
];

export function Toolbar({
  code,
  period,
  range,
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
      <FilterGroup
        label="指数"
        value={code}
        options={PHASE1_INSTRUMENTS.map((item) => ({
          id: item.symbol,
          label: item.shortName,
        }))}
        onChange={onCode}
      />
      <div className="toolbar-split">
        <FilterGroup
          label="周期"
          value={period}
          options={[
            { id: "D", label: "日" },
            { id: "W", label: "周" },
          ]}
          onChange={onPeriod}
        />
        <FilterGroup label="区间" value={range} options={RANGES} onChange={onRange} />
      </div>
    </div>
  );
}
