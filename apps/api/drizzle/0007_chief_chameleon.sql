ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_intent_number_unique";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "workflow_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_number_unique" UNIQUE("payment_intent_id","workflow_generation","attempt_number");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_workflow_generation_check" CHECK (workflow_generation > 0);