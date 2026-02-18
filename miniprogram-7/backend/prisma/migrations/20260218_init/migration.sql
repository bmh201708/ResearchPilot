-- Create enum types
CREATE TYPE "paper_action_type" AS ENUM ('PASS', 'MARK', 'READ');
CREATE TYPE "comment_status" AS ENUM ('VISIBLE', 'HIDDEN', 'REVIEW');
CREATE TYPE "task_status" AS ENUM ('TODO', 'DOING', 'DONE');
CREATE TYPE "ai_job_type" AS ENUM ('SUMMARY', 'POLISH', 'REBUTTAL');
CREATE TYPE "ai_job_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- users
CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "openid" TEXT NOT NULL UNIQUE,
  "nickname" TEXT,
  "avatar_url" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- user_preferences
CREATE TABLE "user_preferences" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL UNIQUE,
  "domains" JSONB NOT NULL,
  "target_conferences" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_user_preferences_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

-- papers
CREATE TABLE "papers" (
  "id" TEXT PRIMARY KEY,
  "arxiv_id" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "authors" JSONB NOT NULL,
  "abstract" TEXT NOT NULL,
  "published_at" TIMESTAMPTZ NOT NULL,
  "tags" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "idx_papers_published_at" ON "papers" ("published_at");

-- paper_summaries
CREATE TABLE "paper_summaries" (
  "id" TEXT PRIMARY KEY,
  "paper_id" TEXT NOT NULL UNIQUE,
  "summary_bg" TEXT NOT NULL,
  "summary_method" TEXT NOT NULL,
  "summary_contrib" TEXT NOT NULL,
  "model_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_paper_summaries_paper_id"
    FOREIGN KEY ("paper_id") REFERENCES "papers" ("id") ON DELETE CASCADE
);

-- user_paper_actions
CREATE TABLE "user_paper_actions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "paper_id" TEXT NOT NULL,
  "action" "paper_action_type" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_user_paper_actions_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_user_paper_actions_paper_id"
    FOREIGN KEY ("paper_id") REFERENCES "papers" ("id") ON DELETE CASCADE,
  CONSTRAINT "uq_user_paper_action" UNIQUE ("user_id", "paper_id")
);
CREATE INDEX "idx_user_paper_actions_user_created_at"
  ON "user_paper_actions" ("user_id", "created_at");

-- comments
CREATE TABLE "comments" (
  "id" TEXT PRIMARY KEY,
  "paper_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" "comment_status" NOT NULL DEFAULT 'VISIBLE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_comments_paper_id"
    FOREIGN KEY ("paper_id") REFERENCES "papers" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_comments_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
CREATE INDEX "idx_comments_paper_created_at"
  ON "comments" ("paper_id", "created_at");

-- conferences
CREATE TABLE "conferences" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "abstract_deadline" TIMESTAMPTZ,
  "paper_deadline" TIMESTAMPTZ NOT NULL,
  "timezone" TEXT NOT NULL,
  "location" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uq_conference_name_year" UNIQUE ("name", "year")
);

-- missions
CREATE TABLE "missions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "conference_id" TEXT,
  "title" TEXT NOT NULL,
  "deadline" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_missions_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_missions_conference_id"
    FOREIGN KEY ("conference_id") REFERENCES "conferences" ("id") ON DELETE SET NULL
);

-- tasks
CREATE TABLE "tasks" (
  "id" TEXT PRIMARY KEY,
  "mission_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "due_at" TIMESTAMPTZ NOT NULL,
  "status" "task_status" NOT NULL DEFAULT 'TODO',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_tasks_mission_id"
    FOREIGN KEY ("mission_id") REFERENCES "missions" ("id") ON DELETE CASCADE
);
CREATE INDEX "idx_tasks_mission_due_at" ON "tasks" ("mission_id", "due_at");

-- ai_jobs
CREATE TABLE "ai_jobs" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "job_type" "ai_job_type" NOT NULL,
  "input_text" TEXT NOT NULL,
  "status" "ai_job_status" NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_ai_jobs_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
CREATE INDEX "idx_ai_jobs_user_created_at" ON "ai_jobs" ("user_id", "created_at");

-- user_badges
CREATE TABLE "user_badges" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "badge_code" TEXT NOT NULL,
  "unlocked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_user_badges_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "uq_user_badges_user_badge" UNIQUE ("user_id", "badge_code")
);
