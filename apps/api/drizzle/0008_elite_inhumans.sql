CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"aggregate_version" integer DEFAULT 1 NOT NULL,
	"current_attempt_number" integer DEFAULT 0 NOT NULL,
	"workflow_generation" integer DEFAULT 1 NOT NULL,
	"provider_reference" text,
	"last_failure_reason" text,
	"last_failure_retryable" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "deliveries_status_check" CHECK (status IN ('REQUESTED', 'READY', 'IN_TRANSIT', 'DELIVERED', 'FAILED')),
	CONSTRAINT "deliveries_aggregate_version_check" CHECK (aggregate_version > 0),
	CONSTRAINT "deliveries_current_attempt_number_check" CHECK (current_attempt_number >= 0),
	CONSTRAINT "deliveries_workflow_generation_check" CHECK (workflow_generation > 0),
	CONSTRAINT "deliveries_delivered_reference_check" CHECK (status <> 'DELIVERED' OR provider_reference IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"workflow_generation" integer DEFAULT 1 NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_reference" text,
	"failure_reason" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_attempts_provider_idempotency_key_unique" UNIQUE("provider_idempotency_key"),
	CONSTRAINT "delivery_attempts_provider_reference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "delivery_attempts_delivery_generation_number_unique" UNIQUE("delivery_id","workflow_generation","attempt_number"),
	CONSTRAINT "delivery_attempts_status_check" CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "delivery_attempts_number_check" CHECK (attempt_number > 0),
	CONSTRAINT "delivery_attempts_workflow_generation_check" CHECK (workflow_generation > 0),
	CONSTRAINT "delivery_attempts_succeeded_reference_check" CHECK (status <> 'SUCCEEDED' OR provider_reference IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "delivery_callbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"delivery_attempt_id" uuid NOT NULL,
	"callback_id" text NOT NULL,
	"outcome" text NOT NULL,
	"provider_reference" text,
	"failure_reason" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_callbacks_callback_id_unique" UNIQUE("callback_id"),
	CONSTRAINT "delivery_callbacks_delivery_callback_unique" UNIQUE("delivery_id","callback_id"),
	CONSTRAINT "delivery_callbacks_outcome_check" CHECK (outcome IN ('SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "address_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_callbacks" ADD CONSTRAINT "delivery_callbacks_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_callbacks" ADD CONSTRAINT "delivery_callbacks_delivery_attempt_id_delivery_attempts_id_fk" FOREIGN KEY ("delivery_attempt_id") REFERENCES "public"."delivery_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_store_status_created_at_idx" ON "deliveries" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_customer_created_at_idx" ON "deliveries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deliveries_order_id_idx" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_attempts_delivery_created_idx" ON "delivery_attempts" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_status_idx" ON "delivery_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "delivery_callbacks_delivery_received_idx" ON "delivery_callbacks" USING btree ("delivery_id","received_at");