import { GitHubGraphQLClient } from "./github-graphql"
import { AdaptiveResolutionFetcher, createDefaultConfig } from "./binary-search"
import type { DataPoint } from "./binary-search"
import { IssueHistoryCache } from "./cache"
import { SVGChartGenerator } from "./svg-chart"

const CACHE_FRESHNESS_HOURS = 24

class IssueHistoryService {
  private github: GitHubGraphQLClient
  private cache: IssueHistoryCache
  private chartGenerator: SVGChartGenerator

  constructor() {
    this.github = new GitHubGraphQLClient()
    this.cache = new IssueHistoryCache()
    this.chartGenerator = new SVGChartGenerator()
  }

  async getIssueHistorySVG(owner: string, repo: string): Promise<string> {
    const dataPoints = await this.getIssueHistoryDataPoints(owner, repo)
    return this.chartGenerator.generate(dataPoints, `${owner}/${repo}`)
  }

  async getMultiRepoIssueHistorySVG(
    repos: Array<{ owner: string; repo: string }>
  ): Promise<string> {
    const series = await Promise.all(
      repos.map(async ({ owner, repo }) => {
        const dataPoints = await this.getIssueHistoryDataPoints(owner, repo)
        return { repoFullName: `${owner}/${repo}`, dataPoints }
      })
    )

    return this.chartGenerator.generateMultiSeries(series)
  }

  async getIssueHistoryDataPoints(owner: string, repo: string): Promise<DataPoint[]> {
    const cachedRepository = await this.cache.getRepository(owner, repo)

    if (cachedRepository) {
      return this.handleCachedRepositoryData(
        owner,
        repo,
        cachedRepository.id,
        cachedRepository.createdAt
      )
    }

    return this.handleNewRepositoryData(owner, repo)
  }

  private async handleCachedRepositoryData(
    owner: string,
    repo: string,
    repositoryId: number,
    repoCreatedAt: Date
  ): Promise<DataPoint[]> {
    const cachedSnapshots = await this.cache.getSnapshots(repositoryId)
    const latestSnapshot = this.findLatestSnapshot(cachedSnapshots)

    if (latestSnapshot && this.isCacheFresh(latestSnapshot.date)) {
      return cachedSnapshots
    }

    const startDate = latestSnapshot ? latestSnapshot.date : repoCreatedAt
    const endDate = this.createTodayDate()

    const newDataPoints = await this.fetchDataPoints(owner, repo, startDate, endDate)
    const allDataPoints = this.mergeDataPoints(cachedSnapshots, newDataPoints)

    await this.cache.saveSnapshots(repositoryId, newDataPoints)

    return allDataPoints
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

  private createTodayDate(): Date {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    return today
  }
}

export const issueHistoryService = new IssueHistoryService()
export { IssueHistoryService }
