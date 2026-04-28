-- CreateTable
CREATE TABLE "public"."fastauth_consumer_transactions" (
    "id" BIGSERIAL NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "outer_signer_id" TEXT NOT NULL,
    "outer_signer_public_key" TEXT,
    "inner_signer_id" TEXT NOT NULL,
    "inner_receiver_id" TEXT NOT NULL,
    "inner_public_key" TEXT NOT NULL,
    "inner_action_types" TEXT[],
    "execution_status" TEXT,
    "failure_reason" TEXT,
    "linked_sign_event_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fastauth_consumer_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fastauth_consumer_transactions_tx_hash_key"
    ON "public"."fastauth_consumer_transactions"("tx_hash");

-- CreateIndex
CREATE INDEX "fastauth_consumer_transactions_block_timestamp_idx"
    ON "public"."fastauth_consumer_transactions"("block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_consumer_transactions_inner_public_key_block_times_idx"
    ON "public"."fastauth_consumer_transactions"("inner_public_key", "block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_consumer_transactions_inner_signer_id_block_timest_idx"
    ON "public"."fastauth_consumer_transactions"("inner_signer_id", "block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_consumer_transactions_failure_reason_idx"
    ON "public"."fastauth_consumer_transactions"("failure_reason");

-- CreateIndex
CREATE INDEX "fastauth_consumer_transactions_execution_status_block_times_idx"
    ON "public"."fastauth_consumer_transactions"("execution_status", "block_timestamp");
