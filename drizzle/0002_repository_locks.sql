CREATE TABLE "repository_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lock_holder_id" varchar(255) NOT NULL,
	CONSTRAINT "repository_locks_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE INDEX "repository_locks_expires_at_idx" ON "repository_locks" USING btree ("expires_at");
