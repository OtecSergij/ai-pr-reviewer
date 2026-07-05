CREATE TABLE "reviews" (
	"slug" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"pr_title" text NOT NULL,
	"issues" jsonb NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
