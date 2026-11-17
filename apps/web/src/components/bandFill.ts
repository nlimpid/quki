import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from "lightweight-charts";

export type BandPoint = {
  time: string;
  upper: number | null;
  lower: number | null;
};

/** Split the band wherever either boundary is missing. Missing values stay missing. */
export function bandSegments(points: readonly BandPoint[]): BandPoint[][] {
  const segments: BandPoint[][] = [];
  let current: BandPoint[] = [];
  for (const point of points) {
    if (point.upper == null || point.lower == null) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

type Plot = { x: number; upperY: number; lowerY: number };

class BandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private plots: Plot[][],
    private color: string,
  ) {}

  set(plots: Plot[][], color: string) {
    this.plots = plots;
    this.color = color;
  }

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      context.beginPath();
      context.rect(0, 0, mediaSize.width, mediaSize.height);
      context.clip();
      context.fillStyle = this.color;
      for (const segment of this.plots) {
        const first = segment[0];
        if (!first) continue;
        context.beginPath();
        context.moveTo(first.x, first.upperY);
        for (const point of segment) context.lineTo(point.x, point.upperY);
        for (let index = segment.length - 1; index >= 0; index -= 1) {
          const point = segment[index];
          if (point) context.lineTo(point.x, point.lowerY);
        }
        context.closePath();
        context.fill();
      }
      context.restore();
    });
  }
}

/**
 * Fills the area between two lines on the attached series' pane.
 * Lightweight Charts has no built-in two-line area; this uses the supported series primitive API.
 */
export class BandFillPrimitive implements ISeriesPrimitive {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Line"> | null = null;
  private readonly renderer: BandRenderer;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(
    private readonly points: readonly BandPoint[],
    private readonly color: string,
  ) {
    this.renderer = new BandRenderer([], color);
    const view: IPrimitivePaneView = {
      zOrder: () => "bottom",
      renderer: () => this.renderer,
    };
    this.views = [view];
  }

  attached(param: SeriesAttachedParameter) {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<"Line">;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return;
    const plots: Plot[][] = [];
    for (const segment of bandSegments(this.points)) {
      const plot: Plot[] = [];
      for (const point of segment) {
        if (point.upper == null || point.lower == null) continue;
        const x = chart.timeScale().timeToCoordinate(point.time);
        const upperY = series.priceToCoordinate(point.upper);
        const lowerY = series.priceToCoordinate(point.lower);
        if (x == null || upperY == null || lowerY == null) continue;
        plot.push({ x, upperY, lowerY });
      }
      if (plot.length > 1) plots.push(plot);
    }
    this.renderer.set(plots, this.color);
  }

  paneViews() {
    return this.views;
  }
}
