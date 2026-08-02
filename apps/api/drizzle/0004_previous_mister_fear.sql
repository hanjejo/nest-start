CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"quantity" integer NOT NULL,
	"line_amount_minor" integer NOT NULL,
	CONSTRAINT "order_items_order_product_unique" UNIQUE("order_id","product_id"),
	CONSTRAINT "order_items_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "order_items_unit_amount_minor_check" CHECK (unit_amount_minor >= 0),
	CONSTRAINT "order_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "order_items_line_amount_minor_check" CHECK (line_amount_minor >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"total_amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "orders_status_check" CHECK (status IN ('AWAITING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY_FOR_DELIVERY', 'DELIVERING', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "orders_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "orders_total_amount_minor_check" CHECK (total_amount_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_customer_created_at_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_store_id_idx" ON "orders" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "orders_store_status_created_at_idx" ON "orders" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description", "scope", "system")
VALUES
	('00000000-0000-4000-8000-000000000113', 'order.read.store', 'Read orders for an assigned store.', 'STORE', true),
	('00000000-0000-4000-8000-000000000114', 'order.cancel.own', 'Cancel an order owned by the authenticated customer before preparation.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000115', 'order.cancel.store', 'Cancel orders for an assigned store before preparation.', 'STORE', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
VALUES
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000114'),
	('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000113'),
	('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000115'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000113'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000115'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000113'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000114'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000115')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;