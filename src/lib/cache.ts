import { eq, and, gte, lte, desc, sql } from "drizzle-orm"
import { db } from "../db/client"
import { repositories, issueSnapshots, prSnapshots } from "../db/schema"
import type { DataPoint } from "./binary-search"

interface Repository {
  id: number
  owner: string
  name: string
  createdAt: Date
  lastSyncedAt: Date | null
}

interface IssueSnapshotRow {
  snapshotDate: string
  issueCount: number
  closedIssueCount: number
}

interface PRSnapshotRow {
  snapshotDate: string
  prCount: number
  closedPrCount: number
  mergedPrCount: number
}

export class IssueHistoryCache {
  async getRepository(owner: string, name: string): Promise<Repository | null> {
    const result = await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.owner, owner), eq(repositories.name, name)))
      .limit(1)

    if (result.length === 0) {
      return null
    }

    return result[0]
  }

  async createRepository(owner: string, name: string, createdAt: Date): Promise<Repository> {
    const result = await db
      .insert(repositories)
      .values({
        owner,
        name,
        createdAt,
      })
      .returning()

    return result[0]
  }

  async getSnapshots(repositoryId: number): Promise<DataPoint[]> {
    const issueResults = await db
      .select()
      .from(issueSnapshots)
      .where(eq(issueSnapshots.repositoryId, repositoryId))
      .orderBy(issueSnapshots.snapshotDate)

    const prResults = await db
      .select()
      .from(prSnapshots)
      .where(eq(prSnapshots.repositoryId, repositoryId))
      .orderBy(prSnapshots.snapshotDate)

    return this.mergeSnapshotResults(issueResults, prResults)
  }

  async getLatestSnapshot(repositoryId: number): Promise<DataPoint | null> {
    const issueResult = await db
      .select()
      .from(issueSnapshots)
      .where(eq(issueSnapshots.repositoryId, repositoryId))
      .orderBy(desc(issueSnapshots.snapshotDate))
      .limit(1)

    const prResult = await db
      .select()
      .from(prSnapshots)
      .where(eq(prSnapshots.repositoryId, repositoryId))
      .orderBy(desc(prSnapshots.snapshotDate))
      .limit(1)

    if (issueResult.length === 0 && prResult.length === 0) {
      return null
    }

    const issueSnapshot = issueResult[0]
    const prSnapshot = prResult[0]

    const latestDate = this.determineLatestDate(
      issueSnapshot?.snapshotDate,
      prSnapshot?.snapshotDate
    )

    return {
      date: new Date(latestDate),
      count: issueSnapshot?.issueCount ?? 0,
      closedCount: issueSnapshot?.closedIssueCount ?? 0,
      prCount: prSnapshot?.prCount ?? 0,
      closedPrCount: prSnapshot?.closedPrCount ?? 0,
      mergedPrCount: prSnapshot?.mergedPrCount ?? 0,
    }
  }

  async saveSnapshots(repositoryId: number, dataPoints: DataPoint[]): Promise<void> {
    if (dataPoints.length === 0) {
      return
    }

    await this.saveIssueSnapshots(repositoryId, dataPoints)
    await this.savePRSnapshots(repositoryId, dataPoints)
    await this.updateLastSyncedAt(repositoryId)
  }

  async getSnapshotsInRange(
    repositoryId: number,
    startDate: Date,
    endDate: Date
  ): Promise<DataPoint[]> {
    const startDateString = dateToDateString(startDate)
    const endDateString = dateToDateString(endDate)

    const issueResults = await db
      .select()
      .from(issueSnapshots)
      .where(
        and(
          eq(issueSnapshots.repositoryId, repositoryId),
          gte(issueSnapshots.snapshotDate, startDateString),
          lte(issueSnapshots.snapshotDate, endDateString)
        )
      )
      .orderBy(issueSnapshots.snapshotDate)

    const prResults = await db
      .select()
      .from(prSnapshots)
      .where(
        and(
          eq(prSnapshots.repositoryId, repositoryId),
          gte(prSnapshots.snapshotDate, startDateString),
          lte(prSnapshots.snapshotDate, endDateString)
        )
      )
      .orderBy(prSnapshots.snapshotDate)

    return this.mergeSnapshotResults(issueResults, prResults)
  }

  private async saveIssueSnapshots(repositoryId: number, dataPoints: DataPoint[]): Promise<void> {
    const values = dataPoints.map((dataPoint) => ({
      repositoryId,
      snapshotDate: dateToDateString(dataPoint.date),
      issueCount: dataPoint.count,
      closedIssueCount: dataPoint.closedCount,
    }))

    await db
      .insert(issueSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [issueSnapshots.repositoryId, issueSnapshots.snapshotDate],
        set: {
          issueCount: sql`excluded.issue_count`,
          closedIssueCount: sql`excluded.closed_issue_count`,
        },
      })
  }

  private async savePRSnapshots(repositoryId: number, dataPoints: DataPoint[]): Promise<void> {
    const values = dataPoints.map((dataPoint) => ({
      repositoryId,
      snapshotDate: dateToDateString(dataPoint.date),
      prCount: dataPoint.prCount,
      closedPrCount: dataPoint.closedPrCount,
      mergedPrCount: dataPoint.mergedPrCount,
    }))

    await db
      .insert(prSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [prSnapshots.repositoryId, prSnapshots.snapshotDate],
        set: {
          prCount: sql`excluded.pr_count`,
          closedPrCount: sql`excluded.closed_pr_count`,
          mergedPrCount: sql`excluded.merged_pr_count`,
        },
      })
  }

  private async updateLastSyncedAt(repositoryId: number): Promise<void> {
    await db
      .update(repositories)
      .set({ lastSyncedAt: new Date() })
      .where(eq(repositories.id, repositoryId))
  }

  private mergeSnapshotResults(
    issueResults: IssueSnapshotRow[],
    prResults: PRSnapshotRow[]
  ): DataPoint[] {
    const issueMap = new Map<string, IssueSnapshotRow>()
    const prMap = new Map<string, PRSnapshotRow>()

    for (const row of issueResults) {
      issueMap.set(row.snapshotDate, row)
    }

    for (const row of prResults) {
      prMap.set(row.snapshotDate, row)
    }

    const allDates = new Set<string>([...issueMap.keys(), ...prMap.keys()])
    const dataPoints: DataPoint[] = []

    for (const dateKey of allDates) {
      const issueRow = issueMap.get(dateKey)
      const prRow = prMap.get(dateKey)

      dataPoints.push({
        date: new Date(dateKey),
        count: issueRow?.issueCount ?? 0,
        closedCount: issueRow?.closedIssueCount ?? 0,
        prCount: prRow?.prCount ?? 0,
        closedPrCount: prRow?.closedPrCount ?? 0,
        mergedPrCount: prRow?.mergedPrCount ?? 0,
      })
    }

    dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime())

    return dataPoints
  }

  private determineLatestDate(
    issueDate: string | undefined,
    prDate: string | undefined
  ): string {
    if (!issueDate && !prDate) {
      return new Date().toISOString().split("T")[0]
    }

    if (!issueDate) {
      return prDate!
    }

    if (!prDate) {
      return issueDate
    }

    return issueDate > prDate ? issueDate : prDate
  }
}

function dateToDateString(date: Date): string {
  return date.toISOString().split("T")[0]
}
