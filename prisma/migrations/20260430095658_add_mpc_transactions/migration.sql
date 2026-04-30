-- AlterTable
ALTER TABLE "public"."fastauth_user_transactions" ALTER COLUMN "token_symbols" DROP DEFAULT,
ALTER COLUMN "token_amounts" DROP DEFAULT,
ALTER COLUMN "token_decimals" DROP DEFAULT,
ALTER COLUMN "token_values_usd" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."mpc_transactions" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT,
    "block_timestamp" TIMESTAMP(3),
    "signer_account_id" TEXT,
    "signer_public_key" TEXT,
    "receiver_id" TEXT,
    "method_name" TEXT,
    "execution_status" TEXT,
    "failure_reason" TEXT,
    "gas_burnt" BIGINT,
    "attached_deposit_yocto" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpc_transactions_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex
CREATE INDEX "mpc_transactions_block_timestamp_idx" ON "public"."mpc_transactions"("block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_transactions_method_name_block_timestamp_idx" ON "public"."mpc_transactions"("method_name", "block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_transactions_signer_account_id_block_timestamp_idx" ON "public"."mpc_transactions"("signer_account_id", "block_timestamp");

-- RenameIndex
ALTER INDEX "public"."fastauth_user_transactions_execution_status_block_timesta_idx" RENAME TO "fastauth_user_transactions_execution_status_block_timestamp_idx";

-- RenameIndex
ALTER INDEX "public"."fastauth_user_transactions_signer_account_id_block_timesta_idx" RENAME TO "fastauth_user_transactions_signer_account_id_block_timestam_idx";
