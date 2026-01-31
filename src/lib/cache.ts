import { eq, and, gte, lte, desc, sql } from "drizzle-orm"
import { db } from "../db/client"
import { repositories, issueSnapshots } from "../db/schema"
import type { DataPoint } from "./binary-search"

interface Repository {
  id: number
  owner: string
  name: string
  createdAt: Date
  lastSyncedAt: Date | null
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
    const result = await db
      .select()
      .from(issueSnapshots)
      .where(eq(issueSnapshots.repositoryId, repositoryId))
      .orderBy(issueSnapshots.snapshotDate)

    return result.map(snapshotToDataPoint)
  }

  async getLatestSnapshot(repositoryId: number): Promise<DataPoint | null> {
    const result = await db
      .select()
      .from(issueSnapshots)
      .where(eq(issueSnapshots.repositoryId, repositoryId))
      .orderBy(desc(issueSnapshots.snapshotDate))
      .limit(1)

    if (result.length === 0) {
      return null
    }

    return snapshotToDataPoint(result[0])
  }

  async saveSnapshots(repositoryId: number, dataPoints: DataPoint[]): Promise<void> {
    if (dataPoints.length === 0) {
      return
    }

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

    await db
      .update(repositories)
      .set({ lastSyncedAt: new Date() })
      .where(eq(repositories.id, repositoryId))
  }

  async getSnapshotsInRange(
    repositoryId: number,
    startDate: Date,
    endDate: Date
  ): Promise<DataPoint[]> {
    const startDateString = dateToDateString(startDate)
    const endDateString = dateToDateString(endDate)

    const result = await db
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

    return result.map(snapshotToDataPoint)
  }
}

function snapshotToDataPoint(snapshot: {
  snapshotDate: string
  issueCount: number
  closedIssueCount: number
}): DataPoint {
  return {
    date: new Date(snapshot.snapshotDate),
    count: snapshot.issueCount,
    closedCount: snapshot.closedIssueCount,
  }
}

function dateToDateString(date: Date): string {
  return date.toISOString().split("T")[0]
}
