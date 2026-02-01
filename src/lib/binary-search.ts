const MAX_DATES_PER_BATCH = 12

interface DataPoint {
  date: Date
  count: number
  closedCount: number
  prCount: number
  closedPrCount: number
  mergedPrCount: number
}

interface CombinedCounts {
  openCount: number
  closedCount: number
  prOpenCount: number
  prClosedCount: number
  prMergedCount: number
}

interface BinarySearchConfig {
  threshold: number
  maxIntervalDays: number
  minIntervalDays: number
}

interface Segment {
  startDate: Date
  startCounts: CombinedCounts
  endDate: Date
  endCounts: CombinedCounts
}

export class AdaptiveResolutionFetcher {
  constructor(
    private config: BinarySearchConfig,
    private fetchCounts: (dates: Date[]) => Promise<Map<string, CombinedCounts>>
  ) {}

  async discover(repoCreatedAt: Date, endDate: Date): Promise<DataPoint[]> {
    const knownPoints = new Map<string, CombinedCounts>()

    const initialDates = [repoCreatedAt, endDate]
    const initialCounts = await this.fetchCounts(initialDates)

    for (const [dateKey, count] of initialCounts) {
      knownPoints.set(dateKey, count)
    }

    const startCounts = initialCounts.get(this.dateToKey(repoCreatedAt))
    const endCounts = initialCounts.get(this.dateToKey(endDate))

    if (!startCounts || !endCounts) {
      return this.mapToDataPoints(knownPoints)
    }

    let queue: Segment[] = [
      {
        startDate: repoCreatedAt,
        startCounts,
        endDate,
        endCounts,
      },
    ]

    while (queue.length > 0) {
      const segmentsToSubdivide = this.filterSegmentsNeedingSubdivision(queue)

      if (segmentsToSubdivide.length === 0) {
        break
      }

      const midDates = this.collectMidDates(segmentsToSubdivide, knownPoints)

      if (midDates.length > 0) {
        const batches = this.batchDates(midDates, MAX_DATES_PER_BATCH)

        for (const batch of batches) {
          const counts = await this.fetchCounts(batch)
          for (const [dateKey, count] of counts) {
            knownPoints.set(dateKey, count)
          }
        }
      }

      queue = this.createNewSegments(segmentsToSubdivide, knownPoints)
    }

    return this.mapToDataPoints(knownPoints)
  }

  private filterSegmentsNeedingSubdivision(segments: Segment[]): Segment[] {
    return segments.filter((segment) => this.shouldSubdivide(segment))
  }

  private shouldSubdivide(segment: Segment): boolean {
    const daysDiff = this.daysBetween(segment.startDate, segment.endDate)

    if (daysDiff <= this.config.minIntervalDays) {
      return false
    }

    const openDiff = Math.abs(segment.endCounts.openCount - segment.startCounts.openCount)
    const closedDiff = Math.abs(
      segment.endCounts.closedCount - segment.startCounts.closedCount
    )
    const prOpenDiff = Math.abs(segment.endCounts.prOpenCount - segment.startCounts.prOpenCount)
    const prClosedDiff = Math.abs(segment.endCounts.prClosedCount - segment.startCounts.prClosedCount)
    const prMergedDiff = Math.abs(segment.endCounts.prMergedCount - segment.startCounts.prMergedCount)
    const countDiff = Math.max(openDiff, closedDiff, prOpenDiff, prClosedDiff, prMergedDiff)

    return countDiff > this.config.threshold || daysDiff > this.config.maxIntervalDays
  }

  private collectMidDates(segments: Segment[], knownPoints: Map<string, CombinedCounts>): Date[] {
    const midDates: Date[] = []
    const seenKeys = new Set<string>()

    for (const segment of segments) {
      const midDate = this.calculateMidDate(segment.startDate, segment.endDate)
      const midKey = this.dateToKey(midDate)

      if (!knownPoints.has(midKey) && !seenKeys.has(midKey)) {
        midDates.push(midDate)
        seenKeys.add(midKey)
      }
    }

    return midDates
  }

  private createNewSegments(segments: Segment[], knownPoints: Map<string, CombinedCounts>): Segment[] {
    const newSegments: Segment[] = []

    for (const segment of segments) {
      const midDate = this.calculateMidDate(segment.startDate, segment.endDate)
      const midKey = this.dateToKey(midDate)
      const midCounts = knownPoints.get(midKey)

      if (!midCounts) {
        continue
      }

      newSegments.push({
        startDate: segment.startDate,
        startCounts: segment.startCounts,
        endDate: midDate,
        endCounts: midCounts,
      })

      newSegments.push({
        startDate: midDate,
        startCounts: midCounts,
        endDate: segment.endDate,
        endCounts: segment.endCounts,
      })
    }

    return newSegments
  }

  private calculateMidDate(startDate: Date, endDate: Date): Date {
    const startTime = startDate.getTime()
    const endTime = endDate.getTime()
    const midTime = startTime + Math.floor((endTime - startTime) / 2)

    const midDate = new Date(midTime)
    midDate.setUTCHours(0, 0, 0, 0)

    return midDate
  }

  private daysBetween(startDate: Date, endDate: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000
    return Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay)
  }

  private dateToKey(date: Date): string {
    return date.toISOString().split("T")[0]
  }

  private batchDates(dates: Date[], batchSize: number): Date[][] {
    const batches: Date[][] = []

    for (let i = 0; i < dates.length; i += batchSize) {
      batches.push(dates.slice(i, i + batchSize))
    }

    return batches
  }

  private mapToDataPoints(knownPoints: Map<string, CombinedCounts>): DataPoint[] {
    const dataPoints: DataPoint[] = []

    for (const [dateKey, counts] of knownPoints) {
      dataPoints.push({
        date: new Date(dateKey),
        count: counts.openCount,
        closedCount: counts.closedCount,
        prCount: counts.prOpenCount,
        closedPrCount: counts.prClosedCount,
        mergedPrCount: counts.prMergedCount,
      })
    }

    dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime())

    return dataPoints
  }
}

export function createDefaultConfig(): BinarySearchConfig {
  return {
    threshold: Number(process.env.BINARY_SEARCH_THRESHOLD) || 50,
    maxIntervalDays: Number(process.env.BINARY_SEARCH_MAX_INTERVAL) || 30,
    minIntervalDays: Number(process.env.BINARY_SEARCH_MIN_INTERVAL) || 1,
  }
}

export type { DataPoint, BinarySearchConfig, CombinedCounts }
