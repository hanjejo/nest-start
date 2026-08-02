CREATE TABLE "dead_letter_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"consumer_name" text,
	"event_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"producer" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_version" integer,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"payload" jsonb NOT NULL,
	"attempts" integer NOT NULL,
	"reason" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dead_letter_events_source_consumer_event_unique" UNIQUE("source","consumer_name","event_id"),
	CONSTRAINT "dead_letter_events_event_version_check" CHECK (event_version > 0),
	CONSTRAINT "dead_letter_events_attempts_check" CHECK (attempts > 0)
);
--> statement-breakpoint
CREATE TABLE "inbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"consumer_name" text NOT NULL,
	"event_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"producer" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_version" integer,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_events_consumer_event_unique" UNIQUE("consumer_name","event_id"),
	CONSTRAINT "inbox_events_consumer_idempotency_unique" UNIQUE("consumer_name","idempotency_key"),
	CONSTRAINT "inbox_events_event_version_check" CHECK (event_version > 0),
	CONSTRAINT "inbox_events_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "inbox_events_status_check" CHECK (status IN ('PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTERED'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"producer" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_version" integer,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "outbox_events_event_version_check" CHECK (event_version > 0),
	CONSTRAINT "outbox_events_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "outbox_events_status_check" CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "aggregate_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "dead_letter_events_event_id_idx" ON "dead_letter_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "dead_letter_events_source_idx" ON "dead_letter_events" USING btree ("source","failed_at");--> statement-breakpoint
CREATE INDEX "inbox_events_consumer_status_idx" ON "inbox_events" USING btree ("consumer_name","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "inbox_events_event_id_idx" ON "inbox_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "outbox_events_status_attempt_idx" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "outbox_events_event_type_idx" ON "outbox_events" USING btree ("event_type");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_aggregate_version_check" CHECK (aggregate_version > 0);