CREATE TABLE "discovered_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"title" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"pay" text DEFAULT '' NOT NULL,
	"posted" text DEFAULT '' NOT NULL,
	"track" text DEFAULT '' NOT NULL,
	"fit" integer,
	"why" text DEFAULT '' NOT NULL,
	"lead_with" text DEFAULT '' NOT NULL,
	"apply_how" text DEFAULT '' NOT NULL,
	"queue_id" uuid,
	"not_added_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovered_jobs_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
ALTER TABLE "discovered_jobs" ADD CONSTRAINT "discovered_jobs_queue_id_application_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."application_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovered_jobs_created_idx" ON "discovered_jobs" USING btree ("created_at");