CREATE TABLE "settlement_cancellation_facts" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"refund_required" boolean NOT NULL,
	"event_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_cancellation_facts_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "settlement_cancellation_facts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "settlement_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlement_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_event_id" text,
	"details" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "settlement_ledger_entries_type_check" CHECK (entry_type IN ('GROSS', 'FEE', 'REFUND', 'ADJUSTMENT')),
	CONSTRAINT "settlement_ledger_entries_amount_check" CHECK (amount_minor >= -2147483647 AND amount_minor <= 2147483647),
	CONSTRAINT "settlement_ledger_entries_currency_check" CHECK (currency = upper(currency) AND currency <> '')
);
--> statement-breakpoint
CREATE TABLE "settlement_order_facts" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"event_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"aggregate_version" integer,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_order_facts_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "settlement_order_facts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "settlement_order_facts_amount_minor_check" CHECK (amount_minor >= 0 AND amount_minor <= 2147483647),
	CONSTRAINT "settlement_order_facts_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "settlement_order_facts_status_check" CHECK (status IN ('COMPLETED')),
	CONSTRAINT "settlement_order_facts_aggregate_version_check" CHECK (aggregate_version IS NULL OR aggregate_version > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_payment_facts" (
	"payment_intent_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider_reference" text NOT NULL,
	"event_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"aggregate_version" integer,
	"succeeded_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_payment_facts_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "settlement_payment_facts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "settlement_payment_facts_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "settlement_payment_facts_amount_minor_check" CHECK (amount_minor >= 0 AND amount_minor <= 2147483647),
	CONSTRAINT "settlement_payment_facts_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "settlement_payment_facts_aggregate_version_check" CHECK (aggregate_version IS NULL OR aggregate_version > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_refund_facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"refund_amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider_reference" text NOT NULL,
	"event_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_refund_facts_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "settlement_refund_facts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "settlement_refund_facts_payment_reference_unique" UNIQUE("payment_intent_id","provider_reference"),
	CONSTRAINT "settlement_refund_facts_amount_check" CHECK (refund_amount_minor > 0 AND refund_amount_minor <= 2147483647),
	CONSTRAINT "settlement_refund_facts_currency_check" CHECK (currency = upper(currency) AND currency <> '')
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fee_basis_points" integer DEFAULT 250 NOT NULL,
	"gross_amount_minor" integer,
	"payment_amount_minor" integer,
	"fee_amount_minor" integer DEFAULT 0 NOT NULL,
	"refund_amount_minor" integer DEFAULT 0 NOT NULL,
	"adjustment_amount_minor" integer DEFAULT 0 NOT NULL,
	"payable_amount_minor" integer DEFAULT 0 NOT NULL,
	"aggregate_version" integer DEFAULT 1 NOT NULL,
	"workflow_generation" integer DEFAULT 1 NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"eligible_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "settlements_status_check" CHECK (status IN ('PENDING', 'ELIGIBLE', 'RECORDED')),
	CONSTRAINT "settlements_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "settlements_fee_basis_points_check" CHECK (fee_basis_points >= 0 AND fee_basis_points <= 10000),
	CONSTRAINT "settlements_gross_amount_check" CHECK (gross_amount_minor IS NULL OR (gross_amount_minor >= 0 AND gross_amount_minor <= 2147483647)),
	CONSTRAINT "settlements_payment_amount_check" CHECK (payment_amount_minor IS NULL OR (payment_amount_minor >= 0 AND payment_amount_minor <= 2147483647)),
	CONSTRAINT "settlements_fee_amount_check" CHECK (fee_amount_minor >= 0 AND fee_amount_minor <= 2147483647),
	CONSTRAINT "settlements_refund_amount_check" CHECK (refund_amount_minor >= 0 AND refund_amount_minor <= 2147483647),
	CONSTRAINT "settlements_adjustment_amount_check" CHECK (adjustment_amount_minor >= -2147483647 AND adjustment_amount_minor <= 2147483647),
	CONSTRAINT "settlements_payable_amount_check" CHECK (payable_amount_minor >= 0 AND payable_amount_minor <= 2147483647),
	CONSTRAINT "settlements_aggregate_version_check" CHECK (aggregate_version > 0),
	CONSTRAINT "settlements_workflow_generation_check" CHECK (workflow_generation > 0),
	CONSTRAINT "settlements_recorded_at_check" CHECK (status <> 'RECORDED' OR recorded_at IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "settlement_ledger_entries" ADD CONSTRAINT "settlement_ledger_entries_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_cancellation_facts_store_idx" ON "settlement_cancellation_facts" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "settlement_ledger_entries_settlement_created_idx" ON "settlement_ledger_entries" USING btree ("settlement_id","created_at");--> statement-breakpoint
CREATE INDEX "settlement_ledger_entries_store_created_idx" ON "settlement_ledger_entries" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "settlement_ledger_entries_order_idx" ON "settlement_ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "settlement_order_facts_store_idx" ON "settlement_order_facts" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "settlement_payment_facts_order_idx" ON "settlement_payment_facts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "settlement_payment_facts_store_idx" ON "settlement_payment_facts" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "settlement_refund_facts_order_idx" ON "settlement_refund_facts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "settlement_refund_facts_payment_idx" ON "settlement_refund_facts" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "settlements_store_status_created_idx" ON "settlements" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "settlements_status_idx" ON "settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "settlements_order_idx" ON "settlements" USING btree ("order_id");--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description", "scope", "system")
VALUES
	('00000000-0000-4000-8000-000000000119', 'settlement.read.store', 'Read settlement records for an assigned store.', 'STORE', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role_id, '00000000-0000-4000-8000-000000000119'::uuid
FROM (
	VALUES
		('00000000-0000-4000-8000-000000000002'::uuid),
		('00000000-0000-4000-8000-000000000003'::uuid),
		('00000000-0000-4000-8000-000000000004'::uuid)
) AS seeded_roles(role_id)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;