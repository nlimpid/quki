import { CHART_INSTRUMENTS } from "@quki/types";

import { FilterGroup } from "./FilterGroup.js";

export function Toolbar({ code, onCode }: { code: string; onCode: (code: string) => void }) {
  return (
    <div className="index-switch">
      <FilterGroup
        appearance="underline"
        label="指数"
        value={code}
        options={CHART_INSTRUMENTS.map((item) => ({
          id: item.symbol,
          label: (
            <>
              <span>{item.shortName}</span>
              <span className="qk-num switch-code">{item.symbol}</span>
            </>
          ),
        }))}
        onChange={onCode}
      />
    </div>
  );
}
