-- CreateTable
CREATE TABLE "public"."accounts" (
    "account_id" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "public_key_count" INTEGER NOT NULL DEFAULT 0,
    "first_source_event_id" BIGINT,
    "last_source_event_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE INDEX "accounts_first_seen_at_idx" ON "public"."accounts"("first_seen_at");

-- CreateIndex
CREATE INDEX "accounts_last_seen_at_idx" ON "public"."accounts"("last_seen_at");

-- CreateIndex
CREATE INDEX "accounts_account_type_idx" ON "public"."accounts"("account_type");

-- RenameIndex
ALTER INDEX "public"."fastauth_sign_events_user_derived_public_key_block_timestamp_id" RENAME TO "fastauth_sign_events_user_derived_public_key_block_timestam_idx";

-- RenameIndex
ALTER INDEX "public"."relayer_dapps_relayer_account_id_dapp_contract_id_provider_type" RENAME TO "relayer_dapps_relayer_account_id_dapp_contract_id_provider__key";
