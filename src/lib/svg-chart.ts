import type { DataPoint } from "./binary-search";
import { normalizeMetrics, hasIssueMetrics, hasPRMetrics } from "./metrics";
import type { MetricValue } from "./metrics";
import rough from "roughjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ChartOptions {
  width: number;
  height: number;
  padding: number;
  lineColor: string;
  backgroundColor: string;
  gridColor: string;
  textColor: string;
  pointRadius: number;
  targetPointCount: number;
  logScale: boolean;
  alignTimelines: boolean;
  metrics: MetricValue[];
  startDate?: Date;
  endDate?: Date;
  monthStart?: number;
  monthEnd?: number;
}

interface ChartArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PixelPoint {
  x: number;
  y: number;
  date: string;
  count: number;
}

interface ChartSeries {
  repoFullName: string;
  dataPoints: DataPoint[];
  color?: string;
}

interface AxisScale {
  min: number;
  max: number;
  step: number;
  values: number[];
}

interface DisplayPoint {
  date: Date;
  count: number;
}

type LineStyle = "solid" | "dotted" | "short-dash" | "long-dash" | "dash-dot" | "double-dot";

type SymbolStyle = "circle" | "square" | "diamond" | "triangle" | "cross" | "star";

interface MetricLineConfig {
  metric: MetricValue;
  label: string;
  lineStyle: LineStyle;
  symbolStyle: SymbolStyle;
  color: string;
}

const METRIC_LINE_CONFIGS: MetricLineConfig[] = [
  { metric: "created", label: "Issues Created", lineStyle: "solid", symbolStyle: "circle", color: "#22c55e" },
  { metric: "closed", label: "Issues Closed", lineStyle: "dotted", symbolStyle: "square", color: "#22c55e" },
  { metric: "net", label: "Issues Net", lineStyle: "short-dash", symbolStyle: "diamond", color: "#22c55e" },
  { metric: "pr_open", label: "PRs Open", lineStyle: "long-dash", symbolStyle: "triangle", color: "#22c55e" },
  { metric: "pr_closed", label: "PRs Closed", lineStyle: "dash-dot", symbolStyle: "cross", color: "#22c55e" },
  { metric: "pr_merged", label: "PRs Merged", lineStyle: "double-dot", symbolStyle: "star", color: "#22c55e" },
];

const DEFAULT_OPTIONS: ChartOptions = {
  width: 900,
  height: 600,
  padding: 60,
  lineColor: "#22c55e",
  backgroundColor: "#ffffff",
  gridColor: "#111111",
  textColor: "#374151",
  pointRadius: 4,
  targetPointCount: 24,
  logScale: false,
  alignTimelines: false,
  metrics: ["created"],
};

const SERIES_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

const ISSUE_COLOR = "#22c55e";
const PR_COLOR = "#22c55e";

const VIRGIL_FONT_PATHS = [
  resolve(process.cwd(), "public", "fonts", "Virgil.woff2"),
  resolve(process.cwd(), ".output", "public", "fonts", "Virgil.woff2"),
];

const ROUGHNESS = {
  chartLine: { roughness: 1.5, bowing: 1.5, strokeWidth: 3 },
  gridLine: { roughness: 0.6, bowing: 0.4, strokeWidth: 2 },
  frame: { roughness: 1.0, bowing: 1.0, strokeWidth: 1.2 },
  point: { roughness: 1.2, bowing: 1.0, strokeWidth: 1.4 },
};

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30;

type RoughGenerator = ReturnType<typeof rough.generator>;

type Point = Parameters<RoughGenerator["linearPath"]>[0][number];

type PathInfo = ReturnType<RoughGenerator["toPaths"]>[number];

let cachedVirgilFontDataUrl: string | null = null;

const getVirgilFontDataUrl = (): string | null => {
  if (cachedVirgilFontDataUrl !== null) {
    return cachedVirgilFontDataUrl;
  }

  for (const fontPath of VIRGIL_FONT_PATHS) {
    try {
      const fontBuffer = readFileSync(fontPath);
      cachedVirgilFontDataUrl = `data:font/woff2;base64,${fontBuffer.toString("base64")}`;
      break;
    } catch {
      continue;
    }
  }

  if (cachedVirgilFontDataUrl === null) {
    cachedVirgilFontDataUrl = "";
  }

  return cachedVirgilFontDataUrl;
};

export class SVGChartGenerator {
  private options: ChartOptions;

  constructor(options: Partial<ChartOptions> | null = null) {
    const envOptions = this.loadEnvOptions();
    this.options = { ...DEFAULT_OPTIONS, ...envOptions, ...options };
    this.options.metrics = normalizeMetrics(this.options.metrics);
  }

  generate(dataPoints: DataPoint[], repoFullName: string): string {
    const chartArea = this.calculateChartArea();
    const roughGenerator = this.createRoughGenerator(repoFullName);
    const logScale = this.options.logScale;
    const metrics = normalizeMetrics(this.options.metrics);
    const showCreated = metrics.includes("created");
    const showClosed = metrics.includes("closed");
    const showNet = metrics.includes("net");
    const showPrOpen = metrics.includes("pr_open");
    const showPrClosed = metrics.includes("pr_closed");
    const showPrMerged = metrics.includes("pr_merged");

    if (dataPoints.length === 0) {
      return this.buildEmptyChart(this.buildChartTitle(repoFullName, metrics), chartArea);
    }

    const sortedPoints = [...dataPoints].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const displayPoints = this.decimatePoints(sortedPoints);
    const createdPoints = showCreated ? this.extractDisplayPoints(displayPoints, "created") : [];
    const closedPoints = showClosed ? this.extractDisplayPoints(displayPoints, "closed") : [];
    const netPoints = showNet ? this.extractDisplayPoints(displayPoints, "net") : [];
    const prOpenPoints = showPrOpen ? this.extractDisplayPoints(displayPoints, "pr_open") : [];
    const prClosedPoints = showPrClosed ? this.extractDisplayPoints(displayPoints, "pr_closed") : [];
    const prMergedPoints = showPrMerged ? this.extractDisplayPoints(displayPoints, "pr_merged") : [];
    
    const allSeriesPoints = [
      ...createdPoints,
      ...closedPoints,
      ...netPoints,
      ...prOpenPoints,
      ...prClosedPoints,
      ...prMergedPoints,
    ];
    const hasNegativeValues = this.hasNegativeValues(allSeriesPoints);
    const effectiveLogScale = logScale && !hasNegativeValues;

    const pixelPoints = showCreated
      ? this.mapDisplayPointsToPixels(createdPoints, chartArea, {
          logScale: effectiveLogScale,
          allPoints: allSeriesPoints,
        })
      : [];
    const pixelClosedPoints = showClosed
      ? this.mapDisplayPointsToPixels(closedPoints, chartArea, {
          logScale: effectiveLogScale,
          allPoints: allSeriesPoints,
        })
      : [];
    const pixelNetPoints = showNet
      ? this.mapDisplayPointsToPixels(netPoints, chartArea, {
          logScale: effectiveLogScale,
          allPoints: allSeriesPoints,
        })
      : [];
    const pixelPrOpenPoints = showPrOpen
      ? this.mapDisplayPointsToPixels(prOpenPoints, chartArea, {
          logScale: effectiveLogScale,
          allPoints: allSeriesPoints,
        })
      : [];
    const pixelPrClosedPoints = showPrClosed
      ? this.mapDisplayPointsToPixels(prClosedPoints, chartArea, {
          logScale: effectiveLogScale,
          allPoints: allSeriesPoints,
        })
      : [];
    const pixelPrMergedPoints = showPrMerged
      ? this.mapDisplayPointsToPixels(prMergedPoints, chartArea, {
          logScale: effectiveLogScale,
          allPoints: allSeriesPoints,
        })
      : [];
    
    const yScale = this.calculateYAxisScale(
      allSeriesPoints.length > 0 ? allSeriesPoints : this.extractDisplayPoints(displayPoints, "created"),
      effectiveLogScale,
    );
    const dateLabels = this.selectDateLabelsFromDisplayPoints(displayPoints);

    const elements: string[] = [];

    elements.push(this.buildDefs());
    elements.push(this.buildBackground());
    elements.push(this.buildTitle(this.buildChartTitle(repoFullName, metrics)));
    elements.push(this.buildFooter());
    elements.push(this.buildAxisLines(chartArea, roughGenerator));
    elements.push(this.buildYAxis(chartArea, yScale, effectiveLogScale));
    elements.push(this.buildXAxisFromDisplayPoints(chartArea, sortedPoints, dateLabels));
    if (metrics.length > 1) {
      elements.push(
        this.buildLineStyleLegend(chartArea, roughGenerator, metrics),
      );
    }

    if (showCreated && pixelPoints.length > 1) {
      elements.push(
        this.buildPath(pixelPoints, roughGenerator, ISSUE_COLOR, "solid"),
      );
    }
    if (showClosed && pixelClosedPoints.length > 1) {
      elements.push(
        this.buildPath(pixelClosedPoints, roughGenerator, ISSUE_COLOR, "dotted"),
      );
    }
    if (showNet && pixelNetPoints.length > 1) {
      elements.push(
        this.buildPath(pixelNetPoints, roughGenerator, ISSUE_COLOR, "short-dash"),
      );
    }
    if (showPrOpen && pixelPrOpenPoints.length > 1) {
      elements.push(
        this.buildPath(pixelPrOpenPoints, roughGenerator, PR_COLOR, "long-dash"),
      );
    }
    if (showPrClosed && pixelPrClosedPoints.length > 1) {
      elements.push(
        this.buildPath(pixelPrClosedPoints, roughGenerator, PR_COLOR, "dash-dot"),
      );
    }
    if (showPrMerged && pixelPrMergedPoints.length > 1) {
      elements.push(
        this.buildPath(pixelPrMergedPoints, roughGenerator, PR_COLOR, "double-dot"),
      );
    }

    if (showCreated) {
      elements.push(
        this.buildDataPoints(pixelPoints, roughGenerator, ISSUE_COLOR, `${repoFullName}`, "Created", "circle"),
      );
    }
    if (showClosed) {
      elements.push(
        this.buildDataPoints(pixelClosedPoints, roughGenerator, ISSUE_COLOR, `${repoFullName}`, "Closed", "square"),
      );
    }
    if (showNet) {
      elements.push(
        this.buildDataPoints(pixelNetPoints, roughGenerator, ISSUE_COLOR, `${repoFullName}`, "Net Active", "diamond"),
      );
    }
    if (showPrOpen) {
      elements.push(
        this.buildDataPoints(pixelPrOpenPoints, roughGenerator, PR_COLOR, `${repoFullName}`, "Open PRs", "triangle"),
      );
    }
    if (showPrClosed) {
      elements.push(
        this.buildDataPoints(pixelPrClosedPoints, roughGenerator, PR_COLOR, `${repoFullName}`, "Closed PRs", "cross"),
      );
    }
    if (showPrMerged) {
      elements.push(
        this.buildDataPoints(pixelPrMergedPoints, roughGenerator, PR_COLOR, `${repoFullName}`, "Merged PRs", "star"),
      );
    }
    elements.push(this.buildStyles());

    return this.wrapSvg(elements.join("\n"));
  }

  generateMultiSeries(series: ChartSeries[], title: string | null = null): string {
    const chartArea = this.calculateChartArea();
    const logScale = this.options.logScale;
    const alignTimelines = this.options.alignTimelines;
    const metrics = normalizeMetrics(this.options.metrics);
    const showCreated = metrics.includes("created");
    const showClosed = metrics.includes("closed");
    const showNet = metrics.includes("net");
    const showPrOpen = metrics.includes("pr_open");
    const showPrClosed = metrics.includes("pr_closed");
    const showPrMerged = metrics.includes("pr_merged");
    const chartTitle = title ?? this.buildMultiSeriesTitle(metrics);

    if (series.length === 0) {
      return this.buildEmptyChart(chartTitle, chartArea);
    }

    const roughGenerator = this.createRoughGenerator(chartTitle);
    const seriesWithColors = this.assignSeriesColors(series);
    const normalized = alignTimelines
      ? this.normalizeSeriesToElapsedTime(seriesWithColors)
      : { series: seriesWithColors, maxElapsedMs: null as number | null };
    const elapsedRange = alignTimelines
      ? this.getElapsedRange(normalized.maxElapsedMs ?? 0)
      : null;
    const activeSeries =
      alignTimelines && elapsedRange
        ? this.filterSeriesByElapsedRange(
            normalized.series,
            elapsedRange.minElapsedMs,
            elapsedRange.maxElapsedMs,
          )
        : normalized.series;
    const visibleSeries = activeSeries.filter(
      (entry) => entry.dataPoints.length > 0,
    );

    if (visibleSeries.length === 0) {
      return this.buildEmptyChart(chartTitle, chartArea);
    }
    
    const allPoints = activeSeries.flatMap((entry) =>
      entry.dataPoints.flatMap((point) => {
        const points: DisplayPoint[] = [];
        if (showCreated) {
          points.push({ date: point.date, count: point.count });
        }
        if (showClosed) {
          points.push({ date: point.date, count: point.closedCount });
        }
        if (showNet) {
          points.push({ date: point.date, count: point.count - point.closedCount });
        }
        if (showPrOpen) {
          points.push({ date: point.date, count: point.prCount });
        }
        if (showPrClosed) {
          points.push({ date: point.date, count: point.closedPrCount });
        }
        if (showPrMerged) {
          points.push({ date: point.date, count: point.mergedPrCount });
        }
        return points;
      }),
    );
    const sortedAllPoints = [...allPoints].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const minDate = alignTimelines
      ? (elapsedRange?.minElapsedMs ?? 0)
      : sortedAllPoints[0].date.getTime();
    const maxDate = alignTimelines
      ? this.calculateElapsedScaleRange(
          elapsedRange?.minElapsedMs ?? 0,
          elapsedRange?.maxElapsedMs ?? 0,
        ).maxElapsedMs
      : sortedAllPoints[sortedAllPoints.length - 1].date.getTime();
    const counts = sortedAllPoints.map((point) => point.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    const hasNegativeValues = this.hasNegativeValues(sortedAllPoints);
    const effectiveLogScale = logScale && !hasNegativeValues;
    const yScale = this.calculateYAxisScaleFromRange(
      minCount,
      maxCount,
      effectiveLogScale,
    );
    const dateLabels = alignTimelines
      ? []
      : this.selectDateLabelsFromDisplayPoints(sortedAllPoints);

    const elements: string[] = [];

    elements.push(this.buildDefs());
    elements.push(this.buildBackground());
    elements.push(this.buildTitle(chartTitle));
    elements.push(this.buildFooter());
    elements.push(this.buildAxisLines(chartArea, roughGenerator));
    elements.push(this.buildYAxis(chartArea, yScale, effectiveLogScale));
    if (alignTimelines) {
      const elapsedScale = this.calculateElapsedScaleRange(
        elapsedRange?.minElapsedMs ?? 0,
        elapsedRange?.maxElapsedMs ?? 0,
      );
      elements.push(
        this.buildXAxisElapsedTime(
          chartArea,
          elapsedScale.minMonths,
          elapsedScale.maxMonths,
          elapsedScale.values,
        ),
      );
    } else {
      elements.push(
        this.buildXAxisWithRange(chartArea, minDate, maxDate, dateLabels),
      );
    }
    elements.push(this.buildLegend(visibleSeries, chartArea, roughGenerator));
    if (metrics.length > 1) {
      elements.push(
        this.buildLineStyleLegend(chartArea, roughGenerator, metrics),
      );
    }

    for (const entry of visibleSeries) {
      const sortedPoints = [...entry.dataPoints].sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );
      const displayPoints = this.decimatePoints(sortedPoints);
      const createdPoints = showCreated ? this.extractDisplayPoints(displayPoints, "created") : [];
      const closedPoints = showClosed ? this.extractDisplayPoints(displayPoints, "closed") : [];
      const netPoints = showNet ? this.extractDisplayPoints(displayPoints, "net") : [];
      const prOpenPoints = showPrOpen ? this.extractDisplayPoints(displayPoints, "pr_open") : [];
      const prClosedPoints = showPrClosed ? this.extractDisplayPoints(displayPoints, "pr_closed") : [];
      const prMergedPoints = showPrMerged ? this.extractDisplayPoints(displayPoints, "pr_merged") : [];
      
      const pixelPoints = showCreated
        ? this.mapDisplayPointsToPixels(createdPoints, chartArea, {
            minDate,
            maxDate,
            minCount,
            maxCount,
            logScale: effectiveLogScale,
            formatDate: alignTimelines
              ? (date) => this.formatElapsedMonths(date.getTime())
              : undefined,
          })
        : [];
      const pixelClosedPoints = showClosed
        ? this.mapDisplayPointsToPixels(closedPoints, chartArea, {
            minDate,
            maxDate,
            minCount,
            maxCount,
            logScale: effectiveLogScale,
            formatDate: alignTimelines
              ? (date) => this.formatElapsedMonths(date.getTime())
              : undefined,
          })
        : [];
      const pixelNetPoints = showNet
        ? this.mapDisplayPointsToPixels(netPoints, chartArea, {
            minDate,
            maxDate,
            minCount,
            maxCount,
            logScale: effectiveLogScale,
            formatDate: alignTimelines
              ? (date) => this.formatElapsedMonths(date.getTime())
              : undefined,
          })
        : [];
      const pixelPrOpenPoints = showPrOpen
        ? this.mapDisplayPointsToPixels(prOpenPoints, chartArea, {
            minDate,
            maxDate,
            minCount,
            maxCount,
            logScale: effectiveLogScale,
            formatDate: alignTimelines
              ? (date) => this.formatElapsedMonths(date.getTime())
              : undefined,
          })
        : [];
      const pixelPrClosedPoints = showPrClosed
        ? this.mapDisplayPointsToPixels(prClosedPoints, chartArea, {
            minDate,
            maxDate,
            minCount,
            maxCount,
            logScale: effectiveLogScale,
            formatDate: alignTimelines
              ? (date) => this.formatElapsedMonths(date.getTime())
              : undefined,
          })
        : [];
      const pixelPrMergedPoints = showPrMerged
        ? this.mapDisplayPointsToPixels(prMergedPoints, chartArea, {
            minDate,
            maxDate,
            minCount,
            maxCount,
            logScale: effectiveLogScale,
            formatDate: alignTimelines
              ? (date) => this.formatElapsedMonths(date.getTime())
              : undefined,
          })
        : [];

      if (showCreated && pixelPoints.length > 1) {
        elements.push(
          this.buildPath(pixelPoints, roughGenerator, entry.color ?? ISSUE_COLOR, "solid"),
        );
      }
      if (showClosed && pixelClosedPoints.length > 1) {
        elements.push(
          this.buildPath(pixelClosedPoints, roughGenerator, entry.color ?? ISSUE_COLOR, "dotted"),
        );
      }
      if (showNet && pixelNetPoints.length > 1) {
        elements.push(
          this.buildPath(pixelNetPoints, roughGenerator, entry.color ?? ISSUE_COLOR, "short-dash"),
        );
      }
      if (showPrOpen && pixelPrOpenPoints.length > 1) {
        elements.push(
          this.buildPath(pixelPrOpenPoints, roughGenerator, entry.color ?? PR_COLOR, "long-dash"),
        );
      }
      if (showPrClosed && pixelPrClosedPoints.length > 1) {
        elements.push(
          this.buildPath(pixelPrClosedPoints, roughGenerator, entry.color ?? PR_COLOR, "dash-dot"),
        );
      }
      if (showPrMerged && pixelPrMergedPoints.length > 1) {
        elements.push(
          this.buildPath(pixelPrMergedPoints, roughGenerator, entry.color ?? PR_COLOR, "double-dot"),
        );
      }

      if (showCreated) {
        elements.push(
          this.buildDataPoints(pixelPoints, roughGenerator, entry.color ?? ISSUE_COLOR, entry.repoFullName, "Created", "circle"),
        );
      }
      if (showClosed) {
        elements.push(
          this.buildDataPoints(pixelClosedPoints, roughGenerator, entry.color ?? ISSUE_COLOR, entry.repoFullName, "Closed", "square"),
        );
      }
      if (showNet) {
        elements.push(
          this.buildDataPoints(pixelNetPoints, roughGenerator, entry.color ?? ISSUE_COLOR, entry.repoFullName, "Net Active", "diamond"),
        );
      }
      if (showPrOpen) {
        elements.push(
          this.buildDataPoints(pixelPrOpenPoints, roughGenerator, entry.color ?? PR_COLOR, entry.repoFullName, "Open PRs", "triangle"),
        );
      }
      if (showPrClosed) {
        elements.push(
          this.buildDataPoints(pixelPrClosedPoints, roughGenerator, entry.color ?? PR_COLOR, entry.repoFullName, "Closed PRs", "cross"),
        );
      }
      if (showPrMerged) {
        elements.push(
          this.buildDataPoints(pixelPrMergedPoints, roughGenerator, entry.color ?? PR_COLOR, entry.repoFullName, "Merged PRs", "star"),
        );
      }
    }

    elements.push(this.buildStyles());

    return this.wrapSvg(elements.join("\n"));
  }

  private buildChartTitle(repoFullName: string, metrics: MetricValue[]): string {
    const hasIssues = hasIssueMetrics(metrics);
    const hasPRs = hasPRMetrics(metrics);
    
    if (hasIssues && hasPRs) {
      return `${repoFullName} - Issue &amp; PR History`;
    }
    if (hasPRs) {
      return `${repoFullName} - PR History`;
    }
    return `${repoFullName} - Issue History`;
  }

  private buildMultiSeriesTitle(metrics: MetricValue[]): string {
    const hasIssues = hasIssueMetrics(metrics);
    const hasPRs = hasPRMetrics(metrics);
    
    if (hasIssues && hasPRs) {
      return "Issue &amp; PR History";
    }
    if (hasPRs) {
      return "PR History";
    }
    return "Issue History";
  }

  private extractDisplayPoints(dataPoints: DataPoint[], metric: MetricValue): DisplayPoint[] {
    return dataPoints.map((point) => ({
      date: point.date,
      count: this.getCountForMetric(point, metric),
    }));
  }

  private getCountForMetric(point: DataPoint, metric: MetricValue): number {
    switch (metric) {
      case "created":
        return point.count;
      case "closed":
        return point.closedCount;
      case "net":
        return point.count - point.closedCount;
      case "pr_open":
        return point.prCount;
      case "pr_closed":
        return point.closedPrCount;
      case "pr_merged":
        return point.mergedPrCount;
    }
  }

  private calculateChartArea(): ChartArea {
    return {
      left: this.options.padding,
      right: this.options.width - this.options.padding,
      top: this.options.padding + 30,
      bottom: this.options.height - this.options.padding,
    };
  }

  private buildEmptyChart(title: string, chartArea: ChartArea): string {
    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;

    const elements: string[] = [];
    elements.push(this.buildDefs());
    elements.push(this.buildBackground());
    elements.push(this.buildTitle(title));
    elements.push(this.buildFooter());
    elements.push(
      `<text x="${centerX}" y="${centerY}" text-anchor="middle" class="chart-text chart-empty">No data</text>`,
    );
    elements.push(this.buildStyles());

    return this.wrapSvg(elements.join("\n"));
  }

  private mapDisplayPointsToPixels(
    displayPoints: DisplayPoint[],
    chartArea: ChartArea,
    scale?: {
      minDate?: number;
      maxDate?: number;
      minCount?: number;
      maxCount?: number;
      logScale?: boolean;
      formatDate?: (date: Date) => string;
      allPoints?: DisplayPoint[];
    },
  ): PixelPoint[] {
    if (displayPoints.length === 0) {
      return [];
    }

    const referencePoints = scale?.allPoints ?? displayPoints;
    const minDate = scale?.minDate ?? referencePoints[0].date.getTime();
    const maxDate =
      scale?.maxDate ?? referencePoints[referencePoints.length - 1].date.getTime();
    const dateRange = maxDate - minDate;

    const counts = referencePoints.map((p) => p.count);
    const minCount = scale?.minCount ?? Math.min(...counts);
    const maxCount = scale?.maxCount ?? Math.max(...counts);
    const logScale = scale?.logScale ?? this.options.logScale;
    const countTransform = this.getCountTransform(logScale);
    const transformedMin = countTransform(minCount);
    const transformedMax = countTransform(maxCount);
    const countRange = transformedMax - transformedMin;

    const chartWidth = chartArea.right - chartArea.left;
    const chartHeight = chartArea.bottom - chartArea.top;

    return displayPoints.map((point) => {
      let x: number;
      if (dateRange === 0) {
        x = chartArea.left + chartWidth / 2;
      } else {
        const dateRatio = (point.date.getTime() - minDate) / dateRange;
        x = chartArea.left + dateRatio * chartWidth;
      }

      let y: number;
      if (countRange === 0) {
        y = chartArea.top + chartHeight / 2;
      } else {
        const countRatio =
          (countTransform(point.count) - transformedMin) / countRange;
        y = chartArea.bottom - countRatio * chartHeight;
      }

      return {
        x,
        y,
        date: scale?.formatDate
          ? scale.formatDate(point.date)
          : this.formatDateISO(point.date),
        count: point.count,
      };
    });
  }

  private calculateYAxisScale(
    displayPoints: DisplayPoint[],
    logScale: boolean,
  ): AxisScale {
    const counts = displayPoints.map((p) => p.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    return this.calculateYAxisScaleFromRange(minCount, maxCount, logScale);
  }

  private calculateYAxisScaleFromRange(
    minCount: number,
    maxCount: number,
    logScale: boolean,
  ): AxisScale {
    return logScale
      ? this.calculateLogAxisScale(minCount, maxCount)
      : this.calculateAxisScale(minCount, maxCount);
  }

  private calculateLogAxisScale(minCount: number, maxCount: number): AxisScale {
    if (minCount === maxCount) {
      const padding = minCount === 0 ? 1 : Math.ceil(minCount * 0.1);
      return {
        min: Math.max(0, minCount - padding),
        max: maxCount + padding,
        step: padding,
        values: [Math.max(0, minCount - padding), minCount, maxCount + padding],
      };
    }

    const safeMin = Math.max(0, minCount);
    const safeMax = Math.max(safeMin + 1, maxCount);
    const minExp = Math.floor(Math.log10(safeMin + 1));
    const maxExp = Math.ceil(Math.log10(safeMax + 1));

    const values: number[] = [];
    if (safeMin === 0) {
      values.push(0);
    }

    for (let exp = minExp; exp <= maxExp; exp++) {
      const value = Math.pow(10, exp);
      if (value >= safeMin && value <= safeMax) {
        values.push(value);
      }
    }

    if (values.length === 0) {
      values.push(safeMin, safeMax);
    } else {
      if (values[0] !== safeMin) {
        values.unshift(safeMin);
      }
      if (values[values.length - 1] !== safeMax) {
        values.push(safeMax);
      }
    }

    return {
      min: safeMin,
      max: safeMax,
      step: values.length > 1 ? values[1] - values[0] : safeMax - safeMin,
      values,
    };
  }

  private calculateAxisScale(min: number, max: number): AxisScale {
    if (min === max) {
      const padding = min === 0 ? 10 : Math.ceil(min * 0.1);
      return {
        min: Math.max(0, min - padding),
        max: max + padding,
        step: padding,
        values: [Math.max(0, min - padding), min, max + padding],
      };
    }

    const range = max - min;
    const roughStep = range / 5;

    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;

    let niceStep: number;
    if (residual <= 1) {
      niceStep = magnitude;
    } else if (residual <= 2) {
      niceStep = 2 * magnitude;
    } else if (residual <= 5) {
      niceStep = 5 * magnitude;
    } else {
      niceStep = 10 * magnitude;
    }

    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;

    const values: number[] = [];
    for (let v = niceMin; v <= niceMax; v += niceStep) {
      values.push(v);
    }

    return {
      min: niceMin,
      max: niceMax,
      step: niceStep,
      values,
    };
  }

  private selectDateLabelsFromDisplayPoints(displayPoints: DisplayPoint[]): Date[] {
    const targetCount = 7;
    const totalPoints = displayPoints.length;

    if (totalPoints <= targetCount) {
      return displayPoints.map((p) => p.date);
    }

    const step = (totalPoints - 1) / (targetCount - 1);
    const labels: Date[] = [];

    for (let i = 0; i < targetCount; i++) {
      const index = Math.round(i * step);
      labels.push(displayPoints[index].date);
    }

    return labels;
  }

  private decimatePoints(dataPoints: DataPoint[]): DataPoint[] {
    if (dataPoints.length <= 2) {
      return dataPoints;
    }

    const targetPointCount = Math.max(2, this.options.targetPointCount);

    if (dataPoints.length <= targetPointCount) {
      return dataPoints;
    }

    if (targetPointCount === 2) {
      return [dataPoints[0], dataPoints[dataPoints.length - 1]];
    }

    const sampled: DataPoint[] = [];
    const bucketSize = (dataPoints.length - 2) / (targetPointCount - 2);
    let aIndex = 0;

    sampled.push(dataPoints[aIndex]);

    for (let i = 0; i < targetPointCount - 2; i++) {
      const bucketStart = Math.floor(i * bucketSize) + 1;
      const bucketEnd = Math.floor((i + 1) * bucketSize) + 1;
      const avgStart = Math.floor((i + 1) * bucketSize) + 1;
      const avgEnd = Math.floor((i + 2) * bucketSize) + 1;

      const avgPoint = this.averagePoint(dataPoints, avgStart, avgEnd);
      const pointA = dataPoints[aIndex];

      let maxArea = -1;
      let maxIndex = bucketStart;

      const safeEnd = Math.min(bucketEnd, dataPoints.length - 1);
      for (let j = bucketStart; j < safeEnd; j++) {
        const point = dataPoints[j];
        const area = Math.abs(
          (pointA.date.getTime() - avgPoint.x) * (point.count - avgPoint.y) -
            (pointA.count - avgPoint.y) * (point.date.getTime() - avgPoint.x),
        );

        if (area > maxArea) {
          maxArea = area;
          maxIndex = j;
        }
      }

      sampled.push(dataPoints[maxIndex]);
      aIndex = maxIndex;
    }

    sampled.push(dataPoints[dataPoints.length - 1]);

    return sampled;
  }

  private buildDefs(): string {
    return `<defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1"/>
    </filter>
  </defs>`;
  }

  private buildBackground(): string {
    return `<rect width="${this.options.width}" height="${this.options.height}" fill="${this.options.backgroundColor}"/>`;
  }

  private buildTitle(title: string): string {
    const x = this.options.width / 2;
    const y = this.options.padding / 2 + 10;

    return `<text x="${x}" y="${y}" text-anchor="middle" class="chart-text chart-title">${title}</text>`;
  }

  private buildFooter(): string {
    const x = this.options.width - this.options.padding;
    const y = this.options.height - this.options.padding + 48;

    return `<text x="${x}" y="${y}" text-anchor="end" class="chart-text chart-footer">github-history.com</text>`;
  }

  private buildLegend(
    series: ChartSeries[],
    chartArea: ChartArea,
    roughGenerator: RoughGenerator,
  ): string {
    const x = chartArea.left + 10;
    let y = chartArea.top - 10;
    const rowHeight = 18;
    const items: string[] = [];

    for (const entry of series) {
      const color = entry.color ?? this.options.lineColor;
      const label = this.escapeXml(entry.repoFullName);

      const roughBox = roughGenerator.rectangle(x, y, 10, 10, {
        stroke: "#111111",
        strokeWidth: 1,
        roughness: ROUGHNESS.gridLine.roughness,
        bowing: ROUGHNESS.gridLine.bowing,
        fill: color,
        fillStyle: "solid",
      });
      items.push(this.buildRoughPaths(roughGenerator.toPaths(roughBox)));
      items.push(
        `<text x="${x + 16}" y="${y + 9}" class="chart-text">${label}</text>`,
      );

      y += rowHeight;
    }

    return `<g class="legend">${items.join("\n")}</g>`;
  }

  private buildLineStyleLegend(
    chartArea: ChartArea,
    roughGenerator: RoughGenerator,
    metrics: MetricValue[],
  ): string {
    const x = chartArea.right - 150;
    const y = chartArea.top - 12;
    const rowHeight = 18;
    const lineLength = 26;
    const symbolX = x + lineLength / 2;
    const items: string[] = [];
    const activeConfigs = METRIC_LINE_CONFIGS.filter((config) => 
      metrics.includes(config.metric)
    );

    activeConfigs.forEach((config, index) => {
      const yOffset = y + index * rowHeight;
      const line = roughGenerator.line(x, yOffset, x + lineLength, yOffset, {
        stroke: config.color,
        strokeWidth: 2,
        roughness: ROUGHNESS.gridLine.roughness,
        bowing: ROUGHNESS.gridLine.bowing,
      });
      items.push(
        this.buildRoughPaths(
          roughGenerator.toPaths(line),
          this.getDashAttributesForStyle(config.lineStyle),
        ),
      );
      items.push(
        this.buildSymbol(symbolX, yOffset, roughGenerator, config.color, config.symbolStyle),
      );
      items.push(
        `<text x="${x + lineLength + 8}" y="${yOffset + 4}" class="chart-text">${this.escapeXml(
          config.label,
        )}</text>`,
      );
    });

    return `<g class="legend legend-line-style">${items.join("\n")}</g>`;
  }

  private assignSeriesColors(series: ChartSeries[]): ChartSeries[] {
    return series.map((entry, index) => ({
      ...entry,
      color: entry.color ?? SERIES_COLORS[index % SERIES_COLORS.length],
    }));
  }

  private buildAxisLines(
    chartArea: ChartArea,
    roughGenerator: RoughGenerator,
  ): string {
    const axisColor = this.options.gridColor;
    const lines = [
      roughGenerator.line(
        chartArea.left,
        chartArea.top,
        chartArea.left,
        chartArea.bottom,
        {
          stroke: axisColor,
          strokeWidth: ROUGHNESS.gridLine.strokeWidth,
          roughness: ROUGHNESS.gridLine.roughness,
          bowing: ROUGHNESS.gridLine.bowing,
        },
      ),
      roughGenerator.line(
        chartArea.left,
        chartArea.bottom,
        chartArea.right,
        chartArea.bottom,
        {
          stroke: axisColor,
          strokeWidth: ROUGHNESS.gridLine.strokeWidth,
          roughness: ROUGHNESS.gridLine.roughness,
          bowing: ROUGHNESS.gridLine.bowing,
        },
      ),
    ];

    return `<g class="axis-lines">${lines
      .map((line) => this.buildRoughPaths(roughGenerator.toPaths(line)))
      .join("\n")}</g>`;
  }

  private buildYAxis(
    chartArea: ChartArea,
    yScale: AxisScale,
    logScale: boolean,
  ): string {
    const labels: string[] = [];
    const chartHeight = chartArea.bottom - chartArea.top;
    const x = chartArea.left - 10;
    const countTransform = this.getCountTransform(logScale);
    const transformedMin = countTransform(yScale.min);
    const transformedMax = countTransform(yScale.max);
    const range = transformedMax - transformedMin;

    for (const value of yScale.values) {
      const ratio =
        range === 0 ? 0.5 : (countTransform(value) - transformedMin) / range;
      const y = chartArea.bottom - ratio * chartHeight;

      labels.push(
        `<text x="${x}" y="${y + 4}" text-anchor="end" class="chart-text chart-axis">${this.formatNumber(
          value,
        )}</text>`,
      );
    }

    return `<g class="y-axis">${labels.join("\n")}</g>`;
  }

  private buildXAxisFromDisplayPoints(
    chartArea: ChartArea,
    dataPoints: DataPoint[],
    dateLabels: Date[],
  ): string {
    const minDate = dataPoints[0].date.getTime();
    const maxDate = dataPoints[dataPoints.length - 1].date.getTime();
    return this.buildXAxisWithRange(chartArea, minDate, maxDate, dateLabels);
  }

  private buildXAxisWithRange(
    chartArea: ChartArea,
    minDate: number,
    maxDate: number,
    dateLabels: Date[],
  ): string {
    const labels: string[] = [];
    const y = chartArea.bottom + 20;
    const dateRange = maxDate - minDate;
    const chartWidth = chartArea.right - chartArea.left;
    const minLabelSpacing = 80;
    let lastLabelX = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < dateLabels.length; index += 1) {
      const date = dateLabels[index];
      let x: number;
      if (dateRange === 0) {
        x = chartArea.left + chartWidth / 2;
      } else {
        const ratio = (date.getTime() - minDate) / dateRange;
        x = chartArea.left + ratio * chartWidth;
      }

      const isFirst = index === 0;
      const isLast = index === dateLabels.length - 1;
      if (!isFirst && !isLast && x - lastLabelX < minLabelSpacing) {
        continue;
      }
      lastLabelX = x;

      labels.push(
        `<text x="${x}" y="${y}" text-anchor="middle" class="chart-text chart-axis chart-axis-x">${this.formatDate(
          date,
        )}</text>`,
      );
    }

    return `<g class="x-axis">${labels.join("\n")}</g>`;
  }

  private buildPath(
    pixelPoints: PixelPoint[],
    roughGenerator: RoughGenerator,
    lineColor: string,
    lineStyle: LineStyle = "solid",
  ): string {
    if (pixelPoints.length < 2) {
      return "";
    }

    const points: Point[] = pixelPoints.map((point) => [point.x, point.y]);
    const roughLine = roughGenerator.linearPath(points, {
      stroke: lineColor,
      strokeWidth: ROUGHNESS.chartLine.strokeWidth,
      roughness: ROUGHNESS.chartLine.roughness,
      bowing: ROUGHNESS.chartLine.bowing,
      preserveVertices: true,
    });

    const dashAttributes = this.getDashAttributesForStyle(lineStyle);

    return `<g class="chart-line">${this.buildRoughPaths(
      roughGenerator.toPaths(roughLine),
      dashAttributes,
    )}</g>`;
  }

  private getDashAttributesForStyle(style: LineStyle): Record<string, string> {
    switch (style) {
      case "solid":
        return {};
      case "dotted":
        return { "stroke-dasharray": "3 6", "stroke-linecap": "round" };
      case "short-dash":
        return { "stroke-dasharray": "8 6", "stroke-linecap": "round" };
      case "long-dash":
        return { "stroke-dasharray": "16 8", "stroke-linecap": "round" };
      case "dash-dot":
        return { "stroke-dasharray": "12 4 3 4", "stroke-linecap": "round" };
      case "double-dot":
        return { "stroke-dasharray": "3 4 3 8", "stroke-linecap": "round" };
    }
  }

  private hasNegativeValues(points: DisplayPoint[]): boolean {
    return points.some((point) => point.count < 0);
  }

  private buildDataPoints(
    pixelPoints: PixelPoint[],
    roughGenerator: RoughGenerator,
    color: string,
    repoFullName: string,
    seriesLabel: string,
    symbolStyle: SymbolStyle = "circle",
  ): string {
    const symbols: string[] = [];
    const safeRepo = this.escapeXml(repoFullName);
    const safeSeries = this.escapeXml(seriesLabel);

    for (const point of pixelPoints) {
      symbols.push(
        this.buildSymbol(point.x, point.y, roughGenerator, color, symbolStyle, {
          class: "data-point",
          "data-date": point.date,
          "data-count": String(point.count),
          "data-repo": safeRepo,
          "data-series": safeSeries,
        }),
      );
    }

    return `<g class="data-points">${symbols.join("\n")}</g>`;
  }

  private buildSymbol(
    x: number,
    y: number,
    roughGenerator: RoughGenerator,
    color: string,
    symbolStyle: SymbolStyle,
    attributes: Record<string, string> = {},
  ): string {
    const size = this.options.pointRadius * 2;
    const halfSize = size / 2;
    const roughOptions = {
      stroke: color,
      strokeWidth: ROUGHNESS.point.strokeWidth,
      roughness: ROUGHNESS.point.roughness,
      bowing: ROUGHNESS.point.bowing,
      fill: color,
      fillStyle: "solid" as const,
    };

    let drawable;
    switch (symbolStyle) {
      case "circle":
        drawable = roughGenerator.circle(x, y, size, roughOptions);
        break;
      case "square":
        drawable = roughGenerator.rectangle(x - halfSize, y - halfSize, size, size, roughOptions);
        break;
      case "diamond":
        drawable = roughGenerator.polygon([
          [x, y - halfSize],
          [x + halfSize, y],
          [x, y + halfSize],
          [x - halfSize, y],
        ], roughOptions);
        break;
      case "triangle":
        drawable = roughGenerator.polygon([
          [x, y - halfSize],
          [x + halfSize, y + halfSize],
          [x - halfSize, y + halfSize],
        ], roughOptions);
        break;
      case "cross": {
        const arm = halfSize * 0.7;
        drawable = roughGenerator.polygon([
          [x - arm, y - halfSize],
          [x + arm, y - halfSize],
          [x + arm, y - arm],
          [x + halfSize, y - arm],
          [x + halfSize, y + arm],
          [x + arm, y + arm],
          [x + arm, y + halfSize],
          [x - arm, y + halfSize],
          [x - arm, y + arm],
          [x - halfSize, y + arm],
          [x - halfSize, y - arm],
          [x - arm, y - arm],
        ], roughOptions);
        break;
      }
      case "star": {
        const outer = halfSize;
        const inner = halfSize * 0.4;
        const points: [number, number][] = [];
        for (let i = 0; i < 5; i++) {
          const outerAngle = (i * 72 - 90) * (Math.PI / 180);
          const innerAngle = ((i * 72) + 36 - 90) * (Math.PI / 180);
          points.push([x + outer * Math.cos(outerAngle), y + outer * Math.sin(outerAngle)]);
          points.push([x + inner * Math.cos(innerAngle), y + inner * Math.sin(innerAngle)]);
        }
        drawable = roughGenerator.polygon(points, roughOptions);
        break;
      }
    }

    return this.buildRoughPaths(roughGenerator.toPaths(drawable), attributes);
  }

  private buildStyles(): string {
    const virgilFontDataUrl = getVirgilFontDataUrl();
    const virgilFontFace = virgilFontDataUrl
      ? `@font-face {
      font-family: "Virgil";
      src: url("${virgilFontDataUrl}") format("woff2");
      font-display: swap;
    }`
      : "";

    return `<style>
    ${virgilFontFace}
    .chart-text {
      font-family: "Virgil", "Segoe UI", system-ui, sans-serif;
      fill: ${this.options.textColor};
    }
    .chart-title {
      font-size: 22px;
      font-weight: 600;
    }
    .chart-axis {
      font-size: 16px;
      font-weight: 600;
      fill: #111111;
    }
    .chart-axis-x {
      font-size: 15px;
      font-weight: 600;
    }
    .legend .chart-text {
      font-weight: 600;
    }
    .chart-empty {
      font-size: 22px;
    }
    .chart-footer {
      font-size: 18px;
      opacity: 0.9;
    }
    .data-point {
      cursor: pointer;
      transition: transform 0.15s ease;
      transform-box: fill-box;
      transform-origin: center;
    }
    .data-point:hover { transform: scale(1.3); }
  </style>`;
  }

  private wrapSvg(content: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.options.width}" height="${this.options.height}" viewBox="0 0 ${this.options.width} ${this.options.height}">
${content}
</svg>`;
  }

  private formatDate(date: Date): string {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return `${month} ${year}`;
  }

  private formatDateISO(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private formatElapsedMonths(milliseconds: number): string {
    const months = Math.max(0, Math.round(milliseconds / MS_PER_MONTH));
    return `${months} month${months === 1 ? "" : "s"}`;
  }

  private formatNumber(n: number): string {
    if (n >= 1000000) {
      const value = n / 1000000;
      return value % 1 === 0 ? `${value}M` : `${value.toFixed(1)}M`;
    }
    if (n >= 1000) {
      const value = n / 1000;
      return value % 1 === 0 ? `${value}k` : `${value.toFixed(1)}k`;
    }
    return String(n);
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private loadEnvOptions(): Partial<ChartOptions> {
    const options: Partial<ChartOptions> = {};
    const targetPointCount = Number(process.env.CHART_TARGET_POINTS);

    if (Number.isFinite(targetPointCount) && targetPointCount >= 2) {
      options.targetPointCount = Math.floor(targetPointCount);
    }

    return options;
  }

  private averagePoint(
    dataPoints: DataPoint[],
    startIndex: number,
    endIndex: number,
  ): { x: number; y: number } {
    const start = Math.max(0, startIndex);
    const end = Math.min(endIndex, dataPoints.length);

    if (start >= end) {
      const fallback = dataPoints[dataPoints.length - 1];
      return { x: fallback.date.getTime(), y: fallback.count };
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let i = start; i < end; i++) {
      sumX += dataPoints[i].date.getTime();
      sumY += dataPoints[i].count;
      count += 1;
    }

    return { x: sumX / count, y: sumY / count };
  }

  private createRoughGenerator(seedInput: string): RoughGenerator {
    const seed = this.hashSeed(seedInput);
    return rough.generator({ options: { seed } });
  }

  private hashSeed(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) || 1;
  }

  private buildRoughPaths(
    paths: PathInfo[],
    attributes: Record<string, string> = {},
  ): string {
    const attributeString = Object.entries(attributes)
      .map(([key, value]) => `${key}="${this.escapeXml(value)}"`)
      .join(" ");

    return paths
      .map((path) => {
        const fill = path.fill ? `fill=\"${path.fill}\"` : 'fill="none"';
        const stroke = path.stroke ? `stroke=\"${path.stroke}\"` : "";
        const strokeWidth = path.strokeWidth
          ? `stroke-width=\"${path.strokeWidth}\"`
          : "";
        const attrs = [stroke, strokeWidth, fill, attributeString]
          .filter(Boolean)
          .join(" ");
        return `<path d="${path.d}" ${attrs}/>`;
      })
      .join("\n");
  }

  private getCountTransform(logScale: boolean): (value: number) => number {
    return logScale ? (value) => Math.log10(value + 1) : (value) => value;
  }

  private normalizeSeriesToElapsedTime(series: ChartSeries[]): {
    series: ChartSeries[];
    maxElapsedMs: number;
  } {
    let maxElapsedMs = 0;
    const normalizedSeries = series.map((entry) => {
      const sorted = [...entry.dataPoints].sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );
      const startDate = sorted[0].date.getTime();
      const normalizedPoints = sorted.map((point) => {
        const elapsedMs = point.date.getTime() - startDate;
        if (elapsedMs > maxElapsedMs) {
          maxElapsedMs = elapsedMs;
        }
        return {
          date: new Date(elapsedMs),
          count: point.count,
          closedCount: point.closedCount,
          prCount: point.prCount,
          closedPrCount: point.closedPrCount,
          mergedPrCount: point.mergedPrCount,
        };
      });

      return {
        ...entry,
        dataPoints: normalizedPoints,
      };
    });

    return { series: normalizedSeries, maxElapsedMs };
  }

  private calculateElapsedScaleRange(
    minElapsedMs: number,
    maxElapsedMs: number,
  ): {
    minElapsedMs: number;
    maxElapsedMs: number;
    minMonths: number;
    maxMonths: number;
    values: number[];
  } {
    const safeMinMs = Math.max(0, minElapsedMs);
    const safeMaxMs = Math.max(safeMinMs, maxElapsedMs);
    const minMonths = Math.max(0, Math.floor(safeMinMs / MS_PER_MONTH));
    const maxMonths = Math.max(minMonths, Math.ceil(safeMaxMs / MS_PER_MONTH));
    const rangeMonths = maxMonths - minMonths;

    if (rangeMonths === 0) {
      return {
        minElapsedMs: minMonths * MS_PER_MONTH,
        maxElapsedMs: maxMonths * MS_PER_MONTH,
        minMonths,
        maxMonths,
        values: [minMonths],
      };
    }

    const step = Math.max(1, Math.ceil(rangeMonths / 6));
    const values: number[] = [];
    for (let v = minMonths; v <= maxMonths; v += step) {
      values.push(v);
    }
    if (values[values.length - 1] !== maxMonths) {
      values.push(maxMonths);
    }

    return {
      minElapsedMs: minMonths * MS_PER_MONTH,
      maxElapsedMs: maxMonths * MS_PER_MONTH,
      minMonths,
      maxMonths,
      values,
    };
  }

  private buildXAxisElapsedTime(
    chartArea: ChartArea,
    minMonths: number,
    maxMonths: number,
    monthValues: number[],
  ): string {
    const labels: string[] = [];
    const y = chartArea.bottom + 20;
    const chartWidth = chartArea.right - chartArea.left;
    const minLabelSpacing = 80;
    let lastLabelX = Number.NEGATIVE_INFINITY;
    const monthRange = Math.max(0, maxMonths - minMonths);

    for (let index = 0; index < monthValues.length; index += 1) {
      const months = monthValues[index];
      const ratio = monthRange === 0 ? 0.5 : (months - minMonths) / monthRange;
      const x = chartArea.left + ratio * chartWidth;

      const isFirst = index === 0;
      const isLast = index === monthValues.length - 1;
      if (!isFirst && !isLast && x - lastLabelX < minLabelSpacing) {
        continue;
      }
      lastLabelX = x;

      labels.push(
        `<text x="${x}" y="${y}" text-anchor="middle" class="chart-text chart-axis chart-axis-x">${this.formatElapsedMonths(
          months * MS_PER_MONTH,
        )}</text>`,
      );
    }

    return `<g class="x-axis">${labels.join("\n")}</g>`;
  }

  private getElapsedRange(maxElapsedMs: number): {
    minElapsedMs: number;
    maxElapsedMs: number;
  } {
    const monthStart = this.options.monthStart;
    const monthEnd = this.options.monthEnd;
    const startMs = Number.isFinite(monthStart)
      ? Math.max(0, Math.floor(monthStart ?? 0) * MS_PER_MONTH)
      : 0;
    const endMs = Number.isFinite(monthEnd)
      ? Math.max(startMs, Math.floor(monthEnd ?? 0) * MS_PER_MONTH)
      : Math.max(startMs, maxElapsedMs);

    return { minElapsedMs: startMs, maxElapsedMs: endMs };
  }

  private filterSeriesByElapsedRange(
    series: ChartSeries[],
    minElapsedMs: number,
    maxElapsedMs: number,
  ): ChartSeries[] {
    return series.map((entry) => {
      const filtered = entry.dataPoints.filter((point) => {
        const time = point.date.getTime();
        return time >= minElapsedMs && time <= maxElapsedMs;
      });
      return { ...entry, dataPoints: filtered };
    });
  }
}
