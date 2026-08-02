CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
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
	CONSTRAINT "payment_attempts_provider_idempotency_key_unique" UNIQUE("provider_idempotency_key"),
	CONSTRAINT "payment_attempts_provider_reference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "payment_attempts_intent_number_unique" UNIQUE("payment_intent_id","attempt_number"),
	CONSTRAINT "payment_attempts_status_check" CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT')),
	CONSTRAINT "payment_attempts_number_check" CHECK (attempt_number > 0),
	CONSTRAINT "payment_attempts_succeeded_reference_check" CHECK (status <> 'SUCCEEDED' OR provider_reference IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payment_callbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"callback_id" text NOT NULL,
	"outcome" text NOT NULL,
	"provider_reference" text,
	"failure_reason" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_callbacks_callback_id_unique" UNIQUE("callback_id"),
	CONSTRAINT "payment_callbacks_intent_callback_unique" UNIQUE("payment_intent_id","callback_id"),
	CONSTRAINT "payment_callbacks_outcome_check" CHECK (outcome IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT'))
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"aggregate_version" integer DEFAULT 1 NOT NULL,
	"current_attempt_number" integer DEFAULT 0 NOT NULL,
	"workflow_generation" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"provider_reference" text,
	"last_failure_reason" text,
	"last_failure_retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payment_intents_status_check" CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED')),
	CONSTRAINT "payment_intents_amount_minor_check" CHECK (amount_minor >= 0),
	CONSTRAINT "payment_intents_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "payment_intents_aggregate_version_check" CHECK (aggregate_version > 0),
	CONSTRAINT "payment_intents_current_attempt_number_check" CHECK (current_attempt_number >= 0),
	CONSTRAINT "payment_intents_workflow_generation_check" CHECK (workflow_generation > 0),
	CONSTRAINT "payment_intents_succeeded_reference_check" CHECK (status <> 'SUCCEEDED' OR provider_reference IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_attempts_intent_created_idx" ON "payment_attempts" USING btree ("payment_intent_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_callbacks_intent_received_idx" ON "payment_callbacks" USING btree ("payment_intent_id","received_at");--> statement-breakpoint
CREATE INDEX "payment_intents_customer_status_idx" ON "payment_intents" USING btree ("customer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payment_intents_status_expiry_idx" ON "payment_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_intents_order_id_idx" ON "payment_intents" USING btree ("order_id");--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description", "scope", "system")
VALUES
	('00000000-0000-4000-8000-000000000116', 'payment.read.own', 'Read payment status for an owned order.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000117', 'payment.read.store', 'Read payment status for an assigned store.', 'STORE', true),
	('00000000-0000-4000-8000-000000000118', 'payment.attempt.own', 'Retry a retryable payment for an owned order.', 'GLOBAL', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
VALUES
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000116'),
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000118'),
	('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000117'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000117'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000116'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000117'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000118')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;