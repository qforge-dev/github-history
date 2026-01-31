import type { DataPoint } from "./binary-search"
import rough from "roughjs"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

interface ChartOptions {
  width: number
  height: number
  padding: number
  lineColor: string
  backgroundColor: string
  gridColor: string
  textColor: string
  pointRadius: number
  targetPointCount: number
}

interface ChartArea {
  left: number
  right: number
  top: number
  bottom: number
}

interface PixelPoint {
  x: number
  y: number
  date: string
  count: number
}

interface AxisScale {
  min: number
  max: number
  step: number
  values: number[]
}

const DEFAULT_OPTIONS: ChartOptions = {
  width: 900,
  height: 600,
  padding: 60,
  lineColor: "#22c55e",
  backgroundColor: "#ffffff",
  gridColor: "#e5e7eb",
  textColor: "#374151",
  pointRadius: 4,
  targetPointCount: 15,
}

const VIRGIL_FONT_PATH = resolve(process.cwd(), "public", "fonts", "Virgil.woff2")

const ROUGHNESS = {
  chartLine: { roughness: 1.5, bowing: 1.5, strokeWidth: 2.2 },
  gridLine: { roughness: 0.6, bowing: 0.4, strokeWidth: 1 },
  frame: { roughness: 1.0, bowing: 1.0, strokeWidth: 1.2 },
  point: { roughness: 1.2, bowing: 1.0, strokeWidth: 1.4 },
}

type RoughGenerator = ReturnType<typeof rough.generator>

type Point = Parameters<RoughGenerator["linearPath"]>[0][number]

type PathInfo = ReturnType<RoughGenerator["toPaths"]>[number]

let cachedVirgilFontDataUrl: string | null = null

const getVirgilFontDataUrl = (): string | null => {
  if (cachedVirgilFontDataUrl !== null) {
    return cachedVirgilFontDataUrl
  }

  try {
    const fontBuffer = readFileSync(VIRGIL_FONT_PATH)
    cachedVirgilFontDataUrl = `data:font/woff2;base64,${fontBuffer.toString("base64")}`
  } catch {
    cachedVirgilFontDataUrl = ""
  }

  return cachedVirgilFontDataUrl
}

export class SVGChartGenerator {
  private options: ChartOptions

  constructor(options: Partial<ChartOptions> | null = null) {
    const envOptions = this.loadEnvOptions()
    this.options = { ...DEFAULT_OPTIONS, ...envOptions, ...options }
  }

  generate(dataPoints: DataPoint[], repoFullName: string): string {
    const chartArea = this.calculateChartArea()
    const roughGenerator = this.createRoughGenerator(repoFullName)

    if (dataPoints.length === 0) {
      return this.buildEmptyChart(repoFullName, chartArea)
    }

    const sortedPoints = [...dataPoints].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )
    const displayPoints = this.decimatePoints(sortedPoints)

    const pixelPoints = this.mapDataToPixels(displayPoints, chartArea)
    const yScale = this.calculateYAxisScale(displayPoints)
    const dateLabels = this.selectDateLabels(displayPoints)

    const elements: string[] = []

    elements.push(this.buildDefs())
    elements.push(this.buildBackground())
    elements.push(this.buildTitle(repoFullName))
    elements.push(this.buildAxisLines(chartArea, roughGenerator))
    elements.push(this.buildYAxis(chartArea, yScale))
    elements.push(this.buildXAxis(chartArea, sortedPoints, dateLabels))

    if (displayPoints.length > 1) {
      elements.push(this.buildPath(pixelPoints, roughGenerator))
    }

    elements.push(this.buildDataPoints(pixelPoints, roughGenerator))
    elements.push(this.buildStyles())

    return this.wrapSvg(elements.join("\n"))
  }

  private calculateChartArea(): ChartArea {
    return {
      left: this.options.padding,
      right: this.options.width - this.options.padding,
      top: this.options.padding + 30,
      bottom: this.options.height - this.options.padding,
    }
  }

  private buildEmptyChart(repoFullName: string, chartArea: ChartArea): string {
    const centerX = (chartArea.left + chartArea.right) / 2
    const centerY = (chartArea.top + chartArea.bottom) / 2

    const elements: string[] = []
    elements.push(this.buildDefs())
    elements.push(this.buildBackground())
    elements.push(this.buildTitle(repoFullName))
    elements.push(
      `<text x="${centerX}" y="${centerY}" text-anchor="middle" class="chart-text chart-empty">No data</text>`
    )
    elements.push(this.buildStyles())

    return this.wrapSvg(elements.join("\n"))
  }

  private mapDataToPixels(dataPoints: DataPoint[], chartArea: ChartArea): PixelPoint[] {
    if (dataPoints.length === 0) {
      return []
    }

    const minDate = dataPoints[0].date.getTime()
    const maxDate = dataPoints[dataPoints.length - 1].date.getTime()
    const dateRange = maxDate - minDate

    const counts = dataPoints.map((p) => p.count)
    const minCount = Math.min(...counts)
    const maxCount = Math.max(...counts)
    const countRange = maxCount - minCount

    const chartWidth = chartArea.right - chartArea.left
    const chartHeight = chartArea.bottom - chartArea.top

    return dataPoints.map((point) => {
      let x: number
      if (dateRange === 0) {
        x = chartArea.left + chartWidth / 2
      } else {
        const dateRatio = (point.date.getTime() - minDate) / dateRange
        x = chartArea.left + dateRatio * chartWidth
      }

      let y: number
      if (countRange === 0) {
        y = chartArea.top + chartHeight / 2
      } else {
        const countRatio = (point.count - minCount) / countRange
        y = chartArea.bottom - countRatio * chartHeight
      }

      return {
        x,
        y,
        date: this.formatDateISO(point.date),
        count: point.count,
      }
    })
  }

  private calculateYAxisScale(dataPoints: DataPoint[]): AxisScale {
    const counts = dataPoints.map((p) => p.count)
    const minCount = Math.min(...counts)
    const maxCount = Math.max(...counts)

    return this.calculateAxisScale(minCount, maxCount)
  }

  private calculateAxisScale(min: number, max: number): AxisScale {
    if (min === max) {
      const padding = min === 0 ? 10 : Math.ceil(min * 0.1)
      return {
        min: Math.max(0, min - padding),
        max: max + padding,
        step: padding,
        values: [Math.max(0, min - padding), min, max + padding],
      }
    }

    const range = max - min
    const roughStep = range / 5

    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
    const residual = roughStep / magnitude

    let niceStep: number
    if (residual <= 1) {
      niceStep = magnitude
    } else if (residual <= 2) {
      niceStep = 2 * magnitude
    } else if (residual <= 5) {
      niceStep = 5 * magnitude
    } else {
      niceStep = 10 * magnitude
    }

    const niceMin = Math.floor(min / niceStep) * niceStep
    const niceMax = Math.ceil(max / niceStep) * niceStep

    const values: number[] = []
    for (let v = niceMin; v <= niceMax; v += niceStep) {
      values.push(v)
    }

    return {
      min: niceMin,
      max: niceMax,
      step: niceStep,
      values,
    }
  }

  private selectDateLabels(dataPoints: DataPoint[]): Date[] {
    const targetCount = 7
    const totalPoints = dataPoints.length

    if (totalPoints <= targetCount) {
      return dataPoints.map((p) => p.date)
    }

    const step = (totalPoints - 1) / (targetCount - 1)
    const labels: Date[] = []

    for (let i = 0; i < targetCount; i++) {
      const index = Math.round(i * step)
      labels.push(dataPoints[index].date)
    }

    return labels
  }

  private decimatePoints(dataPoints: DataPoint[]): DataPoint[] {
    if (dataPoints.length <= 2) {
      return dataPoints
    }

    const targetPointCount = Math.max(2, this.options.targetPointCount)

    if (dataPoints.length <= targetPointCount) {
      return dataPoints
    }

    if (targetPointCount === 2) {
      return [dataPoints[0], dataPoints[dataPoints.length - 1]]
    }

    const sampled: DataPoint[] = []
    const bucketSize = (dataPoints.length - 2) / (targetPointCount - 2)
    let aIndex = 0

    sampled.push(dataPoints[aIndex])

    for (let i = 0; i < targetPointCount - 2; i++) {
      const bucketStart = Math.floor(i * bucketSize) + 1
      const bucketEnd = Math.floor((i + 1) * bucketSize) + 1
      const avgStart = Math.floor((i + 1) * bucketSize) + 1
      const avgEnd = Math.floor((i + 2) * bucketSize) + 1

      const avgPoint = this.averagePoint(dataPoints, avgStart, avgEnd)
      const pointA = dataPoints[aIndex]

      let maxArea = -1
      let maxIndex = bucketStart

      const safeEnd = Math.min(bucketEnd, dataPoints.length - 1)
      for (let j = bucketStart; j < safeEnd; j++) {
        const point = dataPoints[j]
        const area = Math.abs(
          (pointA.date.getTime() - avgPoint.x) *
            (point.count - avgPoint.y) -
            (pointA.count - avgPoint.y) *
              (point.date.getTime() - avgPoint.x)
        )

        if (area > maxArea) {
          maxArea = area
          maxIndex = j
        }
      }

      sampled.push(dataPoints[maxIndex])
      aIndex = maxIndex
    }

    sampled.push(dataPoints[dataPoints.length - 1])

    return sampled
  }

  private buildDefs(): string {
    return `<defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1"/>
    </filter>
  </defs>`
  }

  private buildBackground(): string {
    return `<rect width="${this.options.width}" height="${this.options.height}" fill="${this.options.backgroundColor}"/>`
  }

  private buildTitle(repoFullName: string): string {
    const x = this.options.width / 2
    const y = this.options.padding / 2 + 10
    const title = `${repoFullName} - Issue History`

    return `<text x="${x}" y="${y}" text-anchor="middle" class="chart-text chart-title">${this.escapeXml(
      title
    )}</text>`
  }

  private buildAxisLines(chartArea: ChartArea, roughGenerator: RoughGenerator): string {
    const axisColor = this.options.gridColor
    const lines = [
      roughGenerator.line(chartArea.left, chartArea.top, chartArea.left, chartArea.bottom, {
        stroke: axisColor,
        strokeWidth: ROUGHNESS.gridLine.strokeWidth,
        roughness: ROUGHNESS.gridLine.roughness,
        bowing: ROUGHNESS.gridLine.bowing,
      }),
      roughGenerator.line(chartArea.left, chartArea.bottom, chartArea.right, chartArea.bottom, {
        stroke: axisColor,
        strokeWidth: ROUGHNESS.gridLine.strokeWidth,
        roughness: ROUGHNESS.gridLine.roughness,
        bowing: ROUGHNESS.gridLine.bowing,
      }),
    ]

    return `<g class="axis-lines">${lines
      .map((line) => this.buildRoughPaths(roughGenerator.toPaths(line)))
      .join("\n")}</g>`
  }

  private buildYAxis(chartArea: ChartArea, yScale: AxisScale): string {
    const labels: string[] = []
    const chartHeight = chartArea.bottom - chartArea.top
    const x = chartArea.left - 10

    for (const value of yScale.values) {
      const ratio = (value - yScale.min) / (yScale.max - yScale.min)
      const y = chartArea.bottom - ratio * chartHeight

      labels.push(
        `<text x="${x}" y="${y + 4}" text-anchor="end" class="chart-text chart-axis">${this.formatNumber(
          value
        )}</text>`
      )
    }

    return `<g class="y-axis">${labels.join("\n")}</g>`
  }

  private buildXAxis(
    chartArea: ChartArea,
    dataPoints: DataPoint[],
    dateLabels: Date[]
  ): string {
    const labels: string[] = []
    const y = chartArea.bottom + 20

    const minDate = dataPoints[0].date.getTime()
    const maxDate = dataPoints[dataPoints.length - 1].date.getTime()
    const dateRange = maxDate - minDate
    const chartWidth = chartArea.right - chartArea.left

    for (const date of dateLabels) {
      let x: number
      if (dateRange === 0) {
        x = chartArea.left + chartWidth / 2
      } else {
        const ratio = (date.getTime() - minDate) / dateRange
        x = chartArea.left + ratio * chartWidth
      }

      labels.push(
        `<text x="${x}" y="${y}" text-anchor="middle" class="chart-text chart-axis chart-axis-x">${this.formatDate(
          date
        )}</text>`
      )
    }

    return `<g class="x-axis">${labels.join("\n")}</g>`
  }

  private buildPath(
    pixelPoints: PixelPoint[],
    roughGenerator: RoughGenerator
  ): string {
    if (pixelPoints.length < 2) {
      return ""
    }

    const points: Point[] = pixelPoints.map((point) => [point.x, point.y])
    const roughLine = roughGenerator.linearPath(points, {
      stroke: this.options.lineColor,
      strokeWidth: ROUGHNESS.chartLine.strokeWidth,
      roughness: ROUGHNESS.chartLine.roughness,
      bowing: ROUGHNESS.chartLine.bowing,
      preserveVertices: true,
    })

    return `<g class="chart-line">${this.buildRoughPaths(
      roughGenerator.toPaths(roughLine)
    )}</g>`
  }

  private buildDataPoints(
    pixelPoints: PixelPoint[],
    roughGenerator: RoughGenerator
  ): string {
    const circles: string[] = []

    for (const point of pixelPoints) {
      const roughCircle = roughGenerator.circle(
        point.x,
        point.y,
        this.options.pointRadius * 2,
        {
          stroke: this.options.lineColor,
          strokeWidth: ROUGHNESS.point.strokeWidth,
          roughness: ROUGHNESS.point.roughness,
          bowing: ROUGHNESS.point.bowing,
          fill: this.options.backgroundColor,
          fillStyle: "solid",
        }
      )
      circles.push(
        this.buildRoughPaths(roughGenerator.toPaths(roughCircle), {
          class: "data-point",
          "data-date": point.date,
          "data-count": String(point.count),
        })
      )
    }

    return `<g class="data-points">${circles.join("\n")}</g>`
  }

  private buildStyles(): string {
    const virgilFontDataUrl = getVirgilFontDataUrl()
    const virgilFontFace = virgilFontDataUrl
      ? `@font-face {
      font-family: "Virgil";
      src: url("${virgilFontDataUrl}") format("woff2");
      font-display: swap;
    }`
      : ""

    return `<style>
    ${virgilFontFace}
    .chart-text {
      font-family: "Virgil", "Segoe UI", system-ui, sans-serif;
      fill: ${this.options.textColor};
    }
    .chart-title {
      font-size: 16px;
      font-weight: 600;
    }
    .chart-axis {
      font-size: 12px;
    }
    .chart-axis-x {
      font-size: 11px;
    }
    .chart-empty {
      font-size: 16px;
    }
    .data-point {
      cursor: pointer;
      transition: transform 0.15s ease;
      transform-box: fill-box;
      transform-origin: center;
    }
    .data-point:hover { transform: scale(1.3); }
  </style>`
  }

  private wrapSvg(content: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.options.width}" height="${this.options.height}" viewBox="0 0 ${this.options.width} ${this.options.height}">
${content}
</svg>`
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
    ]
    const month = months[date.getUTCMonth()]
    const year = date.getUTCFullYear()
    return `${month} ${year}`
  }

  private formatDateISO(date: Date): string {
    return date.toISOString().split("T")[0]
  }

  private formatNumber(n: number): string {
    if (n >= 1000000) {
      const value = n / 1000000
      return value % 1 === 0 ? `${value}M` : `${value.toFixed(1)}M`
    }
    if (n >= 1000) {
      const value = n / 1000
      return value % 1 === 0 ? `${value}k` : `${value.toFixed(1)}k`
    }
    return String(n)
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }

  private loadEnvOptions(): Partial<ChartOptions> {
    const options: Partial<ChartOptions> = {}
    const targetPointCount = Number(process.env.CHART_TARGET_POINTS)

    if (Number.isFinite(targetPointCount) && targetPointCount >= 2) {
      options.targetPointCount = Math.floor(targetPointCount)
    }

    return options
  }

  private averagePoint(
    dataPoints: DataPoint[],
    startIndex: number,
    endIndex: number
  ): { x: number; y: number } {
    const start = Math.max(0, startIndex)
    const end = Math.min(endIndex, dataPoints.length)

    if (start >= end) {
      const fallback = dataPoints[dataPoints.length - 1]
      return { x: fallback.date.getTime(), y: fallback.count }
    }

    let sumX = 0
    let sumY = 0
    let count = 0

    for (let i = start; i < end; i++) {
      sumX += dataPoints[i].date.getTime()
      sumY += dataPoints[i].count
      count += 1
    }

    return { x: sumX / count, y: sumY / count }
  }

  private createRoughGenerator(seedInput: string): RoughGenerator {
    const seed = this.hashSeed(seedInput)
    return rough.generator({ options: { seed } })
  }

  private hashSeed(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash) || 1
  }

  private buildRoughPaths(
    paths: PathInfo[],
    attributes: Record<string, string> = {}
  ): string {
    const attributeString = Object.entries(attributes)
      .map(([key, value]) => `${key}="${this.escapeXml(value)}"`)
      .join(" ")

    return paths
      .map((path) => {
        const fill = path.fill ? `fill=\"${path.fill}\"` : "fill=\"none\""
        const stroke = path.stroke ? `stroke=\"${path.stroke}\"` : ""
        const strokeWidth = path.strokeWidth
          ? `stroke-width=\"${path.strokeWidth}\"`
          : ""
        const attrs = [stroke, strokeWidth, fill, attributeString]
          .filter(Boolean)
          .join(" ")
        return `<path d="${path.d}" ${attrs}/>`
      })
      .join("\n")
  }
}
