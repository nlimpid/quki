import {
  XYComponentCore,
  type XYComponentConfigInterface,
} from "@unovis/ts";

import type { SampleBar } from "./sampleOhlc.js";

type CandleConfig = Partial<XYComponentConfigInterface<SampleBar>> & {
  up: string;
  down: string;
};

/**
 * Application-owned OHLC renderer. Unovis 1.8.1 has no candlestick component.
 * This class only draws wicks and bodies. The XYContainer still owns the scales,
 * axes, clipping, and crosshair.
 */
export class CandleSeries extends XYComponentCore<SampleBar, CandleConfig> {
  protected _defaultConfig = {
    x: (bar: SampleBar) => bar.i,
    y: [(bar: SampleBar) => bar.low, (bar: SampleBar) => bar.high],
    up: "#dc2626",
    down: "#15803d",
    duration: 0,
    events: {},
    attributes: {},
  } as CandleConfig;

  constructor(config: CandleConfig) {
    super();
    this.clippable = true;
    this.setConfig({ ...this._defaultConfig, ...config });
  }

  getYDataExtent(): number[] {
    const data = this.datamodel?.data ?? [];
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const bar of data) {
      low = Math.min(low, bar.low);
      high = Math.max(high, bar.high);
    }
    return Number.isFinite(low) ? [low, high] : [0, 1];
  }

  _render(): void {
    const data = this.datamodel?.data ?? [];
    const step = data.length > 1 ? Math.abs(this.xScale(1) - this.xScale(0)) : 12;
    const width = Math.max(2, Math.min(14, step * 0.62));
    const groups = this.g.selectAll<SVGGElement, SampleBar>("g.ohlc").data(data, (bar) => bar.time);
    groups.exit().remove();
    const enter = groups.enter().append("g").attr("class", "ohlc");
    enter.append("line").attr("class", "wick");
    enter.append("rect").attr("class", "body");
    enter
      .merge(groups)
      .each((bar, index, nodes) => {
        const node = nodes[index];
        if (!node) return;
        const x = this.xScale(bar.i);
        const rising = bar.close >= bar.open;
        const color = rising ? this.config.up : this.config.down;
        const top = this.yScale(Math.max(bar.open, bar.close));
        const bottom = this.yScale(Math.min(bar.open, bar.close));
        const wick = node.querySelector("line");
        const body = node.querySelector("rect");
        wick?.setAttribute("x1", String(x));
        wick?.setAttribute("x2", String(x));
        wick?.setAttribute("y1", String(this.yScale(bar.high)));
        wick?.setAttribute("y2", String(this.yScale(bar.low)));
        wick?.setAttribute("stroke", color);
        body?.setAttribute("x", String(x - width / 2));
        body?.setAttribute("y", String(top));
        body?.setAttribute("width", String(width));
        body?.setAttribute("height", String(Math.max(1, bottom - top)));
        body?.setAttribute("fill", color);
      });
  }
}
