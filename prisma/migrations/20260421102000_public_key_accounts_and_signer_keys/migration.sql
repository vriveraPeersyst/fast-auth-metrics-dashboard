-- Add signer public key to raw NEAR transaction storage.
ALTER TABLE "public"."near_transactions"
  ADD COLUMN "signer_public_key" TEXT;

-- Add relayer public key to derived FastAuth sign events.
ALTER TABLE "public"."fastauth_sign_events"
  ADD COLUMN "relayer_public_key" TEXT;

CREATE INDEX "fastauth_sign_events_relayer_public_key_block_timestamp_idx"
  ON "public"."fastauth_sign_events"("relayer_public_key", "block_timestamp");

-- Create public-key-to-account mapping table used for account KPI derivation.
CREATE TABLE "public"."fastauth_public_key_accounts" (
  "id" BIGSERIAL NOT NULL,
  "public_key" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "last_source_event_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fastauth_public_key_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fastauth_public_key_accounts_public_key_account_id_key"
  ON "public"."fastauth_public_key_accounts"("public_key", "account_id");

CREATE INDEX "fastauth_public_key_accounts_account_id_idx"
  ON "public"."fastauth_public_key_accounts"("account_id");

CREATE INDEX "fastauth_public_key_accounts_last_seen_at_idx"
  ON "public"."fastauth_public_key_accounts"("last_seen_at");

CREATE INDEX "fastauth_public_key_accounts_first_seen_at_idx"
  ON "public"."fastauth_public_key_accounts"("first_seen_at");
