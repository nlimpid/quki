import {
  XYComponentCore,
  type XYComponentConfigInterface,
} from "@unovis/ts";

import type { SampleBar } from "./sampleOhlc.js";

type VolumeConfig = Partial<XYComponentConfigInterface<SampleBar>>;

/** Application-owned volume bars on the same index scale as CandleSeries. */
export class VolumeSeries extends XYComponentCore<SampleBar, VolumeConfig> {
  protected _defaultConfig = {
    x: (bar: SampleBar) => bar.i,
    y: (bar: SampleBar) => bar.volume,
    duration: 0,
    events: {},
    attributes: {},
  } as VolumeConfig;

  constructor(config?: VolumeConfig) {
    super();
    this.clippable = true;
    this.setConfig({ ...this._defaultConfig, ...config });
  }

  getYDataExtent(): number[] {
    const data = this.datamodel?.data ?? [];
    const peak = data.reduce((max, bar) => Math.max(max, bar.volume), 0);
    return [0, peak || 1];
  }

  _render(): void {
    const data = this.datamodel?.data ?? [];
    const step = data.length > 1 ? Math.abs(this.xScale(1) - this.xScale(0)) : 12;
    const width = Math.max(2, Math.min(14, step * 0.62));
    const bars = this.g.selectAll<SVGRectElement, SampleBar>("rect.vol").data(data, (bar) => bar.time);
    bars.exit().remove();
    bars
      .enter()
      .append("rect")
      .attr("class", "vol")
      .merge(bars)
      .each((bar, index, nodes) => {
        const node = nodes[index];
        if (!node) return;
        const x = this.xScale(bar.i);
        const y = this.yScale(bar.volume);
        const base = this.yScale(0);
        const prev = data[index - 1]?.close ?? bar.open;
        node.setAttribute("x", String(x - width / 2));
        node.setAttribute("y", String(Math.min(y, base)));
        node.setAttribute("width", String(width));
        node.setAttribute("height", String(Math.max(1, Math.abs(base - y))));
        node.setAttribute("fill", bar.close >= prev ? "#dc262659" : "#15803d59");
      });
  }
}
