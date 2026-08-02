CREATE TABLE "authentication_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"family_id" uuid,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	CONSTRAINT "refresh_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_session_id_refresh_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."refresh_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authentication_events_user_id_idx" ON "authentication_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "authentication_events_family_id_idx" ON "authentication_events" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions" USING btree ("family_id");