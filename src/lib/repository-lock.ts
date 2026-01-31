import { and, eq, lte } from "drizzle-orm"
import { db } from "../db/client"
import { repositoryLocks } from "../db/schema"

const DEFAULT_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000

export class RepositoryLock {
  private lockHolderId: string
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    private lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
    private heartbeatIntervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS
  ) {
    this.lockHolderId = crypto.randomUUID()
  }

  async acquireLock(owner: string, name: string): Promise<boolean> {
    await this.cleanupExpiredLocks()

    for (let attempt = 0; attempt < 2; attempt++) {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + this.lockTimeoutMs)

      const inserted = await db
        .insert(repositoryLocks)
        .values({
          owner,
          name,
          lockedAt: now,
          lastHeartbeatAt: now,
          expiresAt,
          lockHolderId: this.lockHolderId,
        })
        .onConflictDoNothing()
        .returning({ id: repositoryLocks.id })

      if (inserted.length > 0) {
        this.startHeartbeat(owner, name)
        return true
      }

      const existing = await db
        .select({ expiresAt: repositoryLocks.expiresAt })
        .from(repositoryLocks)
        .where(and(eq(repositoryLocks.owner, owner), eq(repositoryLocks.name, name)))
        .limit(1)

      if (existing.length === 0) {
        continue
      }

      if (existing[0].expiresAt.getTime() <= Date.now()) {
        await db
          .delete(repositoryLocks)
          .where(
            and(
              eq(repositoryLocks.owner, owner),
              eq(repositoryLocks.name, name),
              lte(repositoryLocks.expiresAt, new Date())
            )
          )
        continue
      }

      return false
    }

    return false
  }

  async releaseLock(owner: string, name: string): Promise<void> {
    this.stopHeartbeat(owner, name)

    await db
      .delete(repositoryLocks)
      .where(
        and(
          eq(repositoryLocks.owner, owner),
          eq(repositoryLocks.name, name),
          eq(repositoryLocks.lockHolderId, this.lockHolderId)
        )
      )
  }

  async refreshLock(owner: string, name: string): Promise<boolean> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.lockTimeoutMs)

    const updated = await db
      .update(repositoryLocks)
      .set({ lastHeartbeatAt: now, expiresAt })
      .where(
        and(
          eq(repositoryLocks.owner, owner),
          eq(repositoryLocks.name, name),
          eq(repositoryLocks.lockHolderId, this.lockHolderId)
        )
      )
      .returning({ id: repositoryLocks.id })

    return updated.length > 0
  }

  async cleanupExpiredLocks(): Promise<number> {
    const deleted = await db
      .delete(repositoryLocks)
      .where(lte(repositoryLocks.expiresAt, new Date()))
      .returning({ id: repositoryLocks.id })

    return deleted.length
  }

  private startHeartbeat(owner: string, name: string): void {
    const key = this.key(owner, name)
    this.stopHeartbeat(owner, name)

    const timer = setInterval(async () => {
      try {
        const refreshed = await this.refreshLock(owner, name)
        if (!refreshed) {
          this.stopHeartbeat(owner, name)
        }
      } catch {
        this.stopHeartbeat(owner, name)
      }
    }, this.heartbeatIntervalMs)

    this.heartbeatTimers.set(key, timer)
  }

  private stopHeartbeat(owner: string, name: string): void {
    const key = this.key(owner, name)
    const timer = this.heartbeatTimers.get(key)
    if (timer) {
      clearInterval(timer)
      this.heartbeatTimers.delete(key)
    }
  }

  private key(owner: string, name: string): string {
    return `${owner}/${name}`
  }
}
