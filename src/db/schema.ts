import { pgTable, serial, varchar, timestamp, date, integer, unique, index } from "drizzle-orm/pg-core";

export const repositories = pgTable(
  "repositories",
  {
    id: serial("id").primaryKey(),
    owner: varchar("owner", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (table) => [
    unique("repositories_owner_name_unique").on(table.owner, table.name),
    index("repositories_owner_idx").on(table.owner),
    index("repositories_name_idx").on(table.name),
  ]
);

export const issueSnapshots = pgTable(
  "issue_snapshots",
  {
    id: serial("id").primaryKey(),
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    issueCount: integer("issue_count").notNull(),
    closedIssueCount: integer("closed_issue_count").notNull().default(0),
  },
  (table) => [
    unique("issue_snapshots_repository_date_unique").on(table.repositoryId, table.snapshotDate),
    index("issue_snapshots_repository_id_idx").on(table.repositoryId),
    index("issue_snapshots_snapshot_date_idx").on(table.snapshotDate),
  ]
);

export const repositoryLocks = pgTable(
  "repository_locks",
  {
    id: serial("id").primaryKey(),
    owner: varchar("owner", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lockHolderId: varchar("lock_holder_id", { length: 255 }).notNull(),
  },
  (table) => [
    unique("repository_locks_owner_name_unique").on(table.owner, table.name),
    index("repository_locks_expires_at_idx").on(table.expiresAt),
  ]
);
