-- CreateTable: per-tx receipt-level classification of consumer transactions.
-- Source of truth for the Consumer Outcomes panel's Failed/Pending counts;
-- populated by collectFastAuthConsumerHealth from fastauth_consumer_transactions.
CREATE TABLE "public"."fastauth_consumer_health_tx" (
    "tx_hash" TEXT NOT NULL,
    "signer_id" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "failing_executor_id" TEXT,
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMP(3),
    "last_error" TEXT,
    "classified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fastauth_consumer_health_tx_pkey" PRIMARY KEY ("tx_hash")
);

CREATE INDEX "fastauth_consumer_health_tx_block_timestamp_outcome_idx"
    ON "public"."fastauth_consumer_health_tx" ("block_timestamp", "outcome");

CREATE INDEX "fastauth_consumer_health_tx_outcome_last_attempted_at_idx"
    ON "public"."fastauth_consumer_health_tx" ("outcome", "last_attempted_at");

-- CreateTable: same shape for real user activity, feeding the Real Activity
-- panel's Failed/Pending counts.
CREATE TABLE "public"."fastauth_user_health_tx" (
    "tx_hash" TEXT NOT NULL,
    "signer_id" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "failing_executor_id" TEXT,
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMP(3),
    "last_error" TEXT,
    "classified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fastauth_user_health_tx_pkey" PRIMARY KEY ("tx_hash")
);

CREATE INDEX "fastauth_user_health_tx_block_timestamp_outcome_idx"
    ON "public"."fastauth_user_health_tx" ("block_timestamp", "outcome");

CREATE INDEX "fastauth_user_health_tx_outcome_last_attempted_at_idx"
    ON "public"."fastauth_user_health_tx" ("outcome", "last_attempted_at");
