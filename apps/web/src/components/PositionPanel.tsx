import type { Overview, TemperatureBand } from "@quki/types";

import { formatLevel, formatPercentile, formatPct, temperatureBandLabel } from "../lib/format.js";

function bandTone(band: TemperatureBand): string {
  if (band === "hot" || band === "extreme_hot") return "hot";
  if (band === "cold" || band === "extreme_cold") return "cold";
  return "neutral";
}

function signedPct(value: number): string {
  const text = formatPct(value);
  return value > 0 ? `+${text}` : text;
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function PositionPanel({ overview }: { overview: Overview }) {
  const temperature = overview.temperature;
  const change = overview.changePct;
  const hasTemp = temperature != null && Number.isFinite(temperature.value);
  return (
    <section className="judgment" aria-label="估值判断">
      <div className="temp-block">
        <div className="temp-head">
          {hasTemp ? (
            <div className="temp-num qk-num">{temperature.value}</div>
          ) : (
            <div className="temp-missing">暂无数据</div>
          )}
          {hasTemp ? (
            <div className={`temp-band ${bandTone(temperature.band)}`}>
              {temperatureBandLabel(temperature.band)}
            </div>
          ) : null}
        </div>
        <div className="temp-scale-row">
          {hasTemp ? (
            <div
              className="temp-meter"
              role="meter"
              aria-label="温度，高表示贵"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={temperature.value}
            >
              <div className="temp-track">
                <i className="temp-needle" style={{ left: `${temperature.value}%` }} />
              </div>
              <div className="temp-ends">
                <span className="qk-num">0</span>
                <span className="qk-num">100</span>
              </div>
            </div>
          ) : (
            <div className="temp-meter" aria-hidden="true">
              <div className="temp-track" />
              <div className="temp-ends">
                <span className="qk-num">0</span>
                <span className="qk-num">100</span>
              </div>
            </div>
          )}
          <p className="temp-note">0–100 · 高表示贵</p>
        </div>
      </div>

      <div className="stat-block">
        {finite(overview.percentile) ? (
          <div className="stat-num qk-num">{formatPercentile(overview.percentile)}</div>
        ) : (
          <div className="temp-missing">暂无数据</div>
        )}
        <div className="stat-title">历史分位</div>
        <p className="stat-note">概率·历史分位</p>
        <p className="stat-note">不是对未来的预测</p>
      </div>

      <div className="stat-block">
        {finite(overview.ratioPct) ? (
          <div className="stat-num qk-num">{formatPct(overview.ratioPct)}</div>
        ) : (
          <div className="temp-missing">暂无数据</div>
        )}
        <div className="stat-title">区间</div>
        <p className="stat-note">收盘 / MA55</p>
        {overview.weekPossiblyOpen ? <p className="stat-note">当周未收盘</p> : null}
      </div>

      <div className="disclose">
        <span>
          收盘{" "}
          {finite(overview.lastClose) ? (
            <b className="qk-num">{formatLevel(overview.lastClose)}</b>
          ) : (
            "暂无数据"
          )}
        </span>
        <span>
          MA55{" "}
          {finite(overview.ma55) ? (
            <b className="qk-num">{formatLevel(overview.ma55)}</b>
          ) : (
            "暂无数据"
          )}
        </span>
        <span>
          日涨跌{" "}
          {change == null ? (
            "暂无数据"
          ) : (
            <b className={`qk-num${change > 0 ? " change-up" : change < 0 ? " change-down" : ""}`}>
              {signedPct(change)}
            </b>
          )}
        </span>
        <span>
          自身分位 P_A{" "}
          {hasTemp ? <b className="qk-num">{temperature.pa.toFixed(1)}%</b> : "暂无数据"}
        </span>
        <span>
          40日相对分位 P_B{" "}
          {hasTemp ? <b className="qk-num">{temperature.pb.toFixed(1)}%</b> : "暂无数据"}
        </span>
      </div>
    </section>
  );
}
