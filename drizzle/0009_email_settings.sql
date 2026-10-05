CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"cold_email" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"scopes" text[] NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_one_active_idx" ON "email_accounts" USING btree ("provider") WHERE "email_accounts"."disconnected_at" is null;