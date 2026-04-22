-- Create table for derived FastAuth sign events parsed from indexed NEAR transactions.
CREATE TABLE "public"."fastauth_sign_events" (
  "id" BIGSERIAL NOT NULL,
  "tx_hash" TEXT NOT NULL,
  "action_index" INTEGER NOT NULL,
  "block_height" BIGINT NOT NULL,
  "block_timestamp" TIMESTAMP(3) NOT NULL,
  "relayer_account_id" TEXT NOT NULL,
  "fastauth_contract_id" TEXT NOT NULL,
  "guard_id" TEXT,
  "guard_name" TEXT,
  "provider_type" TEXT NOT NULL,
  "algorithm" TEXT,
  "project_dapp_id" TEXT,
  "sponsored_account_id" TEXT,
  "sponsored_account_hash" TEXT,
  "verify_payload_hash" TEXT,
  "sign_payload_json" JSONB,
  "execution_status" TEXT,
  "failure_reason" TEXT,
  "gas_burnt" BIGINT,
  "attached_deposit_yocto" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fastauth_sign_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fastauth_sign_events_tx_hash_action_index_key"
  ON "public"."fastauth_sign_events"("tx_hash", "action_index");

CREATE INDEX "fastauth_sign_events_block_timestamp_idx"
  ON "public"."fastauth_sign_events"("block_timestamp");

CREATE INDEX "fastauth_sign_events_relayer_account_id_block_timestamp_idx"
  ON "public"."fastauth_sign_events"("relayer_account_id", "block_timestamp");

CREATE INDEX "fastauth_sign_events_project_dapp_id_block_timestamp_idx"
  ON "public"."fastauth_sign_events"("project_dapp_id", "block_timestamp");

CREATE INDEX "fastauth_sign_events_provider_type_block_timestamp_idx"
  ON "public"."fastauth_sign_events"("provider_type", "block_timestamp");

-- Create relayer mart.
CREATE TABLE "public"."relayers" (
  "account_id" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "total_sign_transactions" INTEGER NOT NULL DEFAULT 0,
  "total_gas_burnt" BIGINT,
  "total_sponsored_unique_accounts" INTEGER NOT NULL DEFAULT 0,
  "project_owner" TEXT,
  "provider_mix_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "relayers_pkey" PRIMARY KEY ("account_id")
);

CREATE INDEX "relayers_last_seen_at_idx"
  ON "public"."relayers"("last_seen_at");

-- Create relayer-by-dapp mart.
CREATE TABLE "public"."relayer_dapps" (
  "id" BIGSERIAL NOT NULL,
  "relayer_account_id" TEXT NOT NULL,
  "dapp_contract_id" TEXT NOT NULL,
  "provider_type" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "total_sign_transactions" INTEGER NOT NULL DEFAULT 0,
  "total_gas_burnt" BIGINT,
  "total_sponsored_unique_accounts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "relayer_dapps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "relayer_dapps_relayer_account_id_dapp_contract_id_provider_type_key"
  ON "public"."relayer_dapps"("relayer_account_id", "dapp_contract_id", "provider_type");

CREATE INDEX "relayer_dapps_relayer_account_id_last_seen_at_idx"
  ON "public"."relayer_dapps"("relayer_account_id", "last_seen_at");

CREATE INDEX "relayer_dapps_dapp_contract_id_last_seen_at_idx"
  ON "public"."relayer_dapps"("dapp_contract_id", "last_seen_at");

-- Create daily TVL snapshot table for accounts seen via relayer interactions.
CREATE TABLE "public"."account_tvl_daily_snapshots" (
  "id" BIGSERIAL NOT NULL,
  "account_id" TEXT NOT NULL,
  "snapshot_date" TIMESTAMP(3) NOT NULL,
  "total_usd" DOUBLE PRECISION,
  "native_near_balance_yocto" TEXT,
  "native_near_locked_yocto" TEXT,
  "assets_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_tvl_daily_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_tvl_daily_snapshots_account_id_snapshot_date_key"
  ON "public"."account_tvl_daily_snapshots"("account_id", "snapshot_date");

CREATE INDEX "account_tvl_daily_snapshots_snapshot_date_idx"
  ON "public"."account_tvl_daily_snapshots"("snapshot_date");
