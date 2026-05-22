CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"image_id" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"chunk_id" text DEFAULT '' NOT NULL,
	"blob_url" text,
	"pathname" text,
	"content" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"image_id" text,
	"upload_order" integer NOT NULL,
	"basename" text NOT NULL,
	"blob_url" text NOT NULL,
	"download_url" text,
	"pathname" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text,
	"width" integer,
	"height" integer,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"duplicate_of_image_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"run_secret_hash" text NOT NULL,
	"encrypted_ai_gateway_token" text,
	"ai_gateway_token_iv" text,
	"ai_gateway_token_tag" text,
	"expected_image_count" integer,
	"max_images" integer DEFAULT 100 NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"analysis_total" integer DEFAULT 0 NOT NULL,
	"raw_analysis_count" integer DEFAULT 0 NOT NULL,
	"synthesized_note_count" integer DEFAULT 0 NOT NULL,
	"rule_chunk_total" integer DEFAULT 0 NOT NULL,
	"rule_chunk_count" integer DEFAULT 0 NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"current_step" text DEFAULT 'Waiting for uploads' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_run_type_scope_unique" ON "artifacts" USING btree ("run_id","type","image_id","model","chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_images_run_path_unique" ON "reference_images" USING btree ("run_id","pathname");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_images_run_image_unique" ON "reference_images" USING btree ("run_id","image_id");