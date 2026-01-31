CREATE TABLE "issue_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"issue_count" integer NOT NULL,
	CONSTRAINT "issue_snapshots_repository_date_unique" UNIQUE("repository_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "repositories_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
ALTER TABLE "issue_snapshots" ADD CONSTRAINT "issue_snapshots_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_snapshots_repository_id_idx" ON "issue_snapshots" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "issue_snapshots_snapshot_date_idx" ON "issue_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "repositories_owner_idx" ON "repositories" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "repositories_name_idx" ON "repositories" USING btree ("name");