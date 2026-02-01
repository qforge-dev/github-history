CREATE TABLE "pr_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"pr_count" integer NOT NULL,
	"closed_pr_count" integer DEFAULT 0 NOT NULL,
	"merged_pr_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pr_snapshots_repository_date_unique" UNIQUE("repository_id","snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "pr_snapshots" ADD CONSTRAINT "pr_snapshots_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_snapshots_repository_id_idx" ON "pr_snapshots" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "pr_snapshots_snapshot_date_idx" ON "pr_snapshots" USING btree ("snapshot_date");