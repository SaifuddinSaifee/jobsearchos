CREATE TABLE "quick_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "quick_links_position_idx" ON "quick_links" USING btree ("position");