import { GitHubGraphQLClient } from "./github-graphql"
import { AdaptiveResolutionFetcher, createDefaultConfig } from "./binary-search"
import type { DataPoint } from "./binary-search"
import { IssueHistoryCache } from "./cache"
import { SVGChartGenerator } from "./svg-chart"
import type { ChartOptions } from "./svg-chart"
import { RepositoryLock } from "./repository-lock"

const CACHE_FRESHNESS_HOURS = 24
const LOCK_WAIT_TIMEOUT_MS = 2 * 60 * 1000
const LOCK_WAIT_INTERVAL_MS = 2000

class IssueHistoryService {
  private github: GitHubGraphQLClient
  private cache: IssueHistoryCache
  private chartGenerator: SVGChartGenerator
  private repositoryLock: RepositoryLock
  private inFlightRequests = new Map<string, Promise<DataPoint[]>>()

  constructor() {
    this.github = new GitHubGraphQLClient()
    this.cache = new IssueHistoryCache()
    this.chartGenerator = new SVGChartGenerator()
    this.repositoryLock = new RepositoryLock()
  }

  async getIssueHistorySVG(
    owner: string,
    repo: string,
    options?: Partial<ChartOptions>
  ): Promise<string> {
    let dataPoints = await this.getIssueHistoryDataPoints(owner, repo)
    const range = this.resolveDateRange(options?.startDate, options?.endDate)
    if (range.startDate || range.endDate) {
      dataPoints = this.filterByDateRange(dataPoints, range.startDate, range.endDate)
    }
    const chartGenerator = options ? new SVGChartGenerator(options) : this.chartGenerator
    return chartGenerator.generate(dataPoints, `${owner}/${repo}`)
  }

  async getMultiRepoIssueHistorySVG(
    repos: Array<{ owner: string; repo: string }>,
    options?: Partial<ChartOptions>
  ): Promise<string> {
    const range = this.resolveDateRange(options?.startDate, options?.endDate)
    const series = await Promise.all(
      repos.map(async ({ owner, repo }) => {
        let dataPoints = await this.getIssueHistoryDataPoints(owner, repo)
        if (range.startDate || range.endDate) {
          dataPoints = this.filterByDateRange(dataPoints, range.startDate, range.endDate)
        }
        return { repoFullName: `${owner}/${repo}`, dataPoints }
      })
    )

    const chartGenerator = options ? new SVGChartGenerator(options) : this.chartGenerator
    return chartGenerator.generateMultiSeries(series)
  }

  async getIssueHistoryDataPoints(owner: string, repo: string): Promise<DataPoint[]> {
    const cachedRepository = await this.cache.getRepository(owner, repo)

    if (cachedRepository) {
      const cachedSnapshots = await this.cache.getSnapshots(cachedRepository.id)
      const latestSnapshot = this.findLatestSnapshot(cachedSnapshots)

      if (latestSnapshot && this.isCacheFresh(latestSnapshot.date)) {
        return cachedSnapshots
      }

      const lockAcquired = await this.repositoryLock.acquireLock(owner, repo)
      if (!lockAcquired) {
        if (cachedSnapshots.length > 0) {
          return cachedSnapshots
        }

        return await this.waitForRepositoryData(owner, repo)
      }

      return await this.withInFlight(owner, repo, async () => {
        try {
          const startDate = latestSnapshot ? latestSnapshot.date : cachedRepository.createdAt
          const endDate = this.createTodayDate()

          const newDataPoints = await this.fetchDataPoints(owner, repo, startDate, endDate)
          const allDataPoints = this.mergeDataPoints(cachedSnapshots, newDataPoints)

          await this.cache.saveSnapshots(cachedRepository.id, newDataPoints)

          return allDataPoints
        } finally {
          await this.repositoryLock.releaseLock(owner, repo)
        }
      })
    }

    const lockAcquired = await this.repositoryLock.acquireLock(owner, repo)
    if (!lockAcquired) {
      return await this.waitForRepositoryData(owner, repo)
    }

    return await this.withInFlight(owner, repo, async () => {
      try {
        const lockedRepository = await this.cache.getRepository(owner, repo)
        if (lockedRepository) {
          const cachedSnapshots = await this.cache.getSnapshots(lockedRepository.id)
          const latestSnapshot = this.findLatestSnapshot(cachedSnapshots)

          if (latestSnapshot && this.isCacheFresh(latestSnapshot.date)) {
            return cachedSnapshots
          }

          const startDate = latestSnapshot ? latestSnapshot.date : lockedRepository.createdAt
          const endDate = this.createTodayDate()

          const newDataPoints = await this.fetchDataPoints(owner, repo, startDate, endDate)
          const allDataPoints = this.mergeDataPoints(cachedSnapshots, newDataPoints)

          await this.cache.saveSnapshots(lockedRepository.id, newDataPoints)

          return allDataPoints
        }

        return await this.handleNewRepositoryData(owner, repo)
      } finally {
        await this.repositoryLock.releaseLock(owner, repo)
      }
    })
  }

  private async handleNewRepositoryData(owner: string, repo: string): Promise<DataPoint[]> {
    const repoInfo = await this.github.getRepositoryInfo(owner, repo)
    const repository = await this.cache.createRepository(owner, repo, repoInfo.createdAt)

    const startDate = repoInfo.createdAt
    const endDate = this.createTodayDate()

    const dataPoints = await this.fetchDataPoints(owner, repo, startDate, endDate)

    await this.cache.saveSnapshots(repository.id, dataPoints)

    return dataPoints
  }

  private async fetchDataPoints(
    owner: string,
    repo: string,
    startDate: Date,
    endDate: Date
  ): Promise<DataPoint[]> {
    const config = createDefaultConfig()
    const fetcher = new AdaptiveResolutionFetcher(config, (dates: Date[]) =>
      this.github.getIssueCountsAtDates(owner, repo, dates)
    )

    return fetcher.discover(startDate, endDate)
  }

  private findLatestSnapshot(snapshots: DataPoint[]): DataPoint | null {
    if (snapshots.length === 0) {
      return null
    }

    return snapshots.reduce((latest, current) =>
      current.date.getTime() > latest.date.getTime() ? current : latest
    )
  }

  private isCacheFresh(latestDate: Date): boolean {
    const now = new Date()
    const diffMs = now.getTime() - latestDate.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)

    return diffHours < CACHE_FRESHNESS_HOURS
  }

  private mergeDataPoints(cached: DataPoint[], fresh: DataPoint[]): DataPoint[] {
    const dateMap = new Map<string, DataPoint>()

    for (const point of cached) {
      const key = this.dateToKey(point.date)
      dateMap.set(key, point)
    }

    for (const point of fresh) {
      const key = this.dateToKey(point.date)
      dateMap.set(key, point)
    }

    const merged = Array.from(dateMap.values())
    merged.sort((a, b) => a.date.getTime() - b.date.getTime())

    return merged
  }

  private dateToKey(date: Date): string {
    return date.toISOString().split("T")[0]
  }

  private async waitForRepositoryData(owner: string, repo: string): Promise<DataPoint[]> {
    const startTime = Date.now()
    const key = this.repoKey(owner, repo)

    while (Date.now() - startTime < LOCK_WAIT_TIMEOUT_MS) {
      const inFlight = this.inFlightRequests.get(key)
      if (inFlight) {
        return inFlight
      }

      const cachedRepository = await this.cache.getRepository(owner, repo)
      if (cachedRepository) {
        const cachedSnapshots = await this.cache.getSnapshots(cachedRepository.id)
        if (cachedSnapshots.length > 0) {
          return cachedSnapshots
        }
      }

      await this.sleep(LOCK_WAIT_INTERVAL_MS)
    }

    throw new Error(
      `Repository ${owner}/${repo} is currently being synced. Please try again shortly.`
    )
  }

  private async withInFlight(
    owner: string,
    repo: string,
    runner: () => Promise<DataPoint[]>
  ): Promise<DataPoint[]> {
    const key = this.repoKey(owner, repo)
    const existing = this.inFlightRequests.get(key)
    if (existing) {
      return existing
    }

    const promise = runner()
    this.inFlightRequests.set(key, promise)

    try {
      return await promise
    } finally {
      if (this.inFlightRequests.get(key) === promise) {
        this.inFlightRequests.delete(key)
      }
    }
  }

  private repoKey(owner: string, repo: string): string {
    return `${owner}/${repo}`
  }

  private async sleep(durationMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs))
  }

  private createTodayDate(): Date {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    return today
  }

  private resolveDateRange(
    startDate?: Date,
    endDate?: Date
  ): { startDate?: Date; endDate?: Date } {
    const start = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined
    const end = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined

    if (start && end && start.getTime() > end.getTime()) {
      return { startDate: end, endDate: start }
    }

    return { startDate: start, endDate: end }
  }

  private filterByDateRange(
    points: DataPoint[],
    startDate?: Date,
    endDate?: Date
  ): DataPoint[] {
    return points.filter((point) => {
      if (startDate && point.date.getTime() < startDate.getTime()) return false
      if (endDate && point.date.getTime() > endDate.getTime()) return false
      return true
    })
  }
}

export const issueHistoryService = new IssueHistoryService()
export { IssueHistoryService }
