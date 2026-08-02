CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_amount_minor_check" CHECK (amount_minor >= 0),
	CONSTRAINT "product_prices_currency_check" CHECK (currency = upper(currency) AND currency <> ''),
	CONSTRAINT "product_prices_effective_range_check" CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lifecycle" text DEFAULT 'DRAFT' NOT NULL,
	"menu_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_store_name_unique" UNIQUE("store_id","name"),
	CONSTRAINT "products_lifecycle_check" CHECK (lifecycle IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'))
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "status" text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "operating_hours" jsonb DEFAULT '{"sunday":[],"monday":[],"tuesday":[],"wednesday":[],"thursday":[],"friday":[],"saturday":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "policies" jsonb DEFAULT '{"acceptingOrders":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_prices_product_effective_idx" ON "product_prices" USING btree ("product_id","effective_from");--> statement-breakpoint
CREATE INDEX "products_store_id_idx" ON "products" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "products_store_visibility_idx" ON "products" USING btree ("store_id","lifecycle","menu_visible");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_status_check" CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'SUSPENDED'));--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_timezone_check" CHECK (timezone = 'UTC');--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description", "scope", "system")
VALUES
	('00000000-0000-4000-8000-000000000110', 'catalog.read', 'Browse the visible catalog for an orderable store.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000111', 'catalog.manage', 'Manage products, prices, lifecycle, and menu visibility for an assigned store.', 'STORE', true),
	('00000000-0000-4000-8000-000000000112', 'store.operations.manage', 'Manage status, operating hours, and policies for an assigned store.', 'STORE', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
VALUES
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000110'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000111'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000112'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000110'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000111'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000112')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
