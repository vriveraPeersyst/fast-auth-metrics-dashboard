-- CreateTable
CREATE TABLE "public"."fastauth_user_transactions" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "signer_account_id" TEXT NOT NULL,
    "signer_public_key" TEXT,
    "receiver_id" TEXT NOT NULL,
    "method_name" TEXT,
    "action_types" TEXT[],
    "execution_status" TEXT,
    "failure_reason" TEXT,
    "gas_burnt" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fastauth_user_transactions_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex
CREATE INDEX "fastauth_user_transactions_block_timestamp_idx"
    ON "public"."fastauth_user_transactions"("block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_user_transactions_signer_account_id_block_timesta_idx"
    ON "public"."fastauth_user_transactions"("signer_account_id", "block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_user_transactions_receiver_id_block_timestamp_idx"
    ON "public"."fastauth_user_transactions"("receiver_id", "block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_user_transactions_method_name_block_timestamp_idx"
    ON "public"."fastauth_user_transactions"("method_name", "block_timestamp");

-- CreateIndex
CREATE INDEX "fastauth_user_transactions_execution_status_block_timesta_idx"
    ON "public"."fastauth_user_transactions"("execution_status", "block_timestamp");
