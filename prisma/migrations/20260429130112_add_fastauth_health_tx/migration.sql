-- CreateTable: per-tx receipt-level chain-health classification.
-- Source of truth for the MPC Status / Fast Auth Status cards and the
-- Transactions panel's Failed/Pending counts. Populated by collectFastAuthHealth
-- from near_transactions; rpc_pending rows are retried in place until classified
-- or until retry_count hits its cap (then frozen as rpc_pending).
CREATE TABLE "public"."fastauth_health_tx" (
    "tx_hash" TEXT NOT NULL,
    "signer_id" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "reached_mpc" BOOLEAN,
    "outcome" TEXT NOT NULL,
    "failing_executor_id" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMP(3),
    "last_error" TEXT,
    "classified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fastauth_health_tx_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex: window aggregation for status cards.
CREATE INDEX "fastauth_health_tx_block_timestamp_outcome_idx"
    ON "public"."fastauth_health_tx" ("block_timestamp", "outcome");

-- CreateIndex: retry sweep (WHERE outcome = 'rpc_pending' AND last_attempted_at < ...).
CREATE INDEX "fastauth_health_tx_outcome_last_attempted_at_idx"
    ON "public"."fastauth_health_tx" ("outcome", "last_attempted_at");

-- CreateIndex: discovery query joins near_transactions on (receiver_id IN (...)).
-- Composite with block_height supports the ORDER BY block_height ASC LIMIT N
-- in the discovery pass without a separate sort step.
CREATE INDEX "near_transactions_receiver_id_block_height_idx"
    ON "public"."near_transactions" ("receiver_id", "block_height");
