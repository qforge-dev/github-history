import type { DataPoint } from "./binary-search"

interface ChartOptions {
  width: number
  height: number
  padding: number
  lineColor: string
  backgroundColor: string
  gridColor: string
  textColor: string
  pointRadius: number
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
  height: 400,
  padding: 60,
  lineColor: "#22c55e",
  backgroundColor: "#ffffff",
  gridColor: "#e5e7eb",
  textColor: "#374151",
  pointRadius: 4,
}

export class SVGChartGenerator {
  private options: ChartOptions

  constructor(options: Partial<ChartOptions> | null = null) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  generate(dataPoints: DataPoint[], repoFullName: string): string {
    const chartArea = this.calculateChartArea()

    if (dataPoints.length === 0) {
      return this.buildEmptyChart(repoFullName, chartArea)
    }

    const sortedPoints = [...dataPoints].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )

    const pixelPoints = this.mapDataToPixels(sortedPoints, chartArea)
    const yScale = this.calculateYAxisScale(sortedPoints)
    const dateLabels = this.selectDateLabels(sortedPoints)

    const elements: string[] = []

    elements.push(this.buildDefs())
    elements.push(this.buildBackground())
    elements.push(this.buildTitle(repoFullName))
    elements.push(this.buildGridLines(chartArea, yScale))
    elements.push(this.buildYAxis(chartArea, yScale))
    elements.push(this.buildXAxis(chartArea, sortedPoints, dateLabels))

    if (sortedPoints.length > 1) {
      elements.push(this.buildPath(pixelPoints))
    }

    elements.push(this.buildDataPoints(pixelPoints))
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
      `<text x="${centerX}" y="${centerY}" text-anchor="middle" fill="${this.options.textColor}" font-size="16" font-family="system-ui, sans-serif">No data</text>`
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

  private buildDefs(): string {
    return `<defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1"/>
    </filter>
  </defs>`
  }

  private buildBackground(): string {
    return `<rect width="${this.options.width}" height="${this.options.height}" fill="${this.options.backgroundColor}" rx="8" ry="8" stroke="${this.options.gridColor}" stroke-width="1"/>`
  }

  private buildTitle(repoFullName: string): string {
    const x = this.options.width / 2
    const y = this.options.padding / 2 + 10
    const title = `${repoFullName} - Issue History`

    return `<text x="${x}" y="${y}" text-anchor="middle" fill="${this.options.textColor}" font-size="16" font-weight="600" font-family="system-ui, sans-serif">${this.escapeXml(title)}</text>`
  }

  private buildGridLines(chartArea: ChartArea, yScale: AxisScale): string {
    const lines: string[] = []
    const chartHeight = chartArea.bottom - chartArea.top

    for (const value of yScale.values) {
      const ratio = (value - yScale.min) / (yScale.max - yScale.min)
      const y = chartArea.bottom - ratio * chartHeight

      lines.push(
        `<line x1="${chartArea.left}" y1="${y}" x2="${chartArea.right}" y2="${y}" stroke="${this.options.gridColor}" stroke-width="1"/>`
      )
    }

    return `<g class="grid-lines">${lines.join("\n")}</g>`
  }

  private buildYAxis(chartArea: ChartArea, yScale: AxisScale): string {
    const labels: string[] = []
    const chartHeight = chartArea.bottom - chartArea.top
    const x = chartArea.left - 10

    for (const value of yScale.values) {
      const ratio = (value - yScale.min) / (yScale.max - yScale.min)
      const y = chartArea.bottom - ratio * chartHeight

      labels.push(
        `<text x="${x}" y="${y + 4}" text-anchor="end" fill="${this.options.textColor}" font-size="12" font-family="system-ui, sans-serif">${this.formatNumber(value)}</text>`
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
        `<text x="${x}" y="${y}" text-anchor="middle" fill="${this.options.textColor}" font-size="11" font-family="system-ui, sans-serif">${this.formatDate(date)}</text>`
      )
    }

    return `<g class="x-axis">${labels.join("\n")}</g>`
  }

  private buildPath(pixelPoints: PixelPoint[]): string {
    if (pixelPoints.length < 2) {
      return ""
    }

    const d = this.buildPathD(pixelPoints)

    return `<path d="${d}" fill="none" stroke="${this.options.lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  }

  private buildPathD(points: PixelPoint[]): string {
    const parts: string[] = []

    parts.push(`M ${points[0].x} ${points[0].y}`)

    for (let i = 1; i < points.length; i++) {
      parts.push(`L ${points[i].x} ${points[i].y}`)
    }

    return parts.join(" ")
  }

  private buildDataPoints(pixelPoints: PixelPoint[]): string {
    const circles: string[] = []

    for (const point of pixelPoints) {
      circles.push(
        `<circle cx="${point.x}" cy="${point.y}" r="${this.options.pointRadius}" data-date="${point.date}" data-count="${point.count}" class="data-point"/>`
      )
    }

    return `<g class="data-points">${circles.join("\n")}</g>`
  }

  private buildStyles(): string {
    return `<style>
    .data-point { 
      fill: ${this.options.lineColor}; 
      cursor: pointer;
      transition: r 0.15s ease;
    }
    .data-point:hover { r: 8; }
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
}
