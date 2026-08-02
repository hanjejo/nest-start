CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"scope" text NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key"),
	CONSTRAINT "permissions_scope_check" CHECK (scope IN ('GLOBAL', 'STORE'))
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"store_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_permission_unique" UNIQUE("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"assignment_scope" text NOT NULL,
	"global_store_access" boolean DEFAULT false NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name"),
	CONSTRAINT "roles_assignment_scope_check" CHECK (assignment_scope IN ('GLOBAL', 'STORE')),
	CONSTRAINT "roles_global_store_access_check" CHECK (global_store_access = false OR assignment_scope = 'GLOBAL')
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permissions_scope_idx" ON "permissions" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_user_role_store_unique" ON "role_assignments" USING btree ("user_id","role_id","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_user_role_global_unique" ON "role_assignments" USING btree ("user_id","role_id") WHERE "role_assignments"."store_id" IS NULL;--> statement-breakpoint
CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_role_id_idx" ON "role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "role_assignments_store_id_idx" ON "role_assignments" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_store_idx" ON "role_assignments" USING btree ("user_id","store_id");--> statement-breakpoint
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "roles_assignment_scope_idx" ON "roles" USING btree ("assignment_scope");--> statement-breakpoint
CREATE INDEX "stores_name_idx" ON "stores" USING btree ("name");--> statement-breakpoint
INSERT INTO "roles" ("id", "name", "description", "assignment_scope", "global_store_access", "system")
VALUES
	('00000000-0000-4000-8000-000000000001', 'customer', 'A person who places and owns orders.', 'GLOBAL', false, true),
	('00000000-0000-4000-8000-000000000002', 'store-operator', 'A person who performs day-to-day work for an assigned store.', 'STORE', false, true),
	('00000000-0000-4000-8000-000000000003', 'store-admin', 'A person who manages an assigned store configuration.', 'STORE', false, true),
	('00000000-0000-4000-8000-000000000004', 'platform-admin', 'A person with platform-wide operational authority.', 'GLOBAL', true, true);--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description", "scope", "system")
VALUES
	('00000000-0000-4000-8000-000000000101', 'store.directory.read', 'Browse the platform store directory.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000102', 'order.create', 'Create an order as the authenticated customer.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000103', 'order.read.own', 'Read orders owned by the authenticated customer.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000104', 'store.scope.read', 'Read protected capabilities for an assigned store.', 'STORE', true),
	('00000000-0000-4000-8000-000000000105', 'store.scope.manage', 'Manage protected capabilities for a store.', 'STORE', true),
	('00000000-0000-4000-8000-000000000106', 'rbac.catalog.read', 'Query roles, permissions, and role-permission relationships.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000107', 'rbac.catalog.write', 'Create roles, permissions, and role-permission relationships.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000108', 'rbac.assignment.read', 'Query stores and account role assignments.', 'GLOBAL', true),
	('00000000-0000-4000-8000-000000000109', 'rbac.assignment.write', 'Create account role assignments.', 'GLOBAL', true);--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
VALUES
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101'),
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102'),
	('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103'),
	('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000104'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000104'),
	('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000105'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000101'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000102'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000103'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000104'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000105'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000106'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000107'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000108'),
	('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000109');