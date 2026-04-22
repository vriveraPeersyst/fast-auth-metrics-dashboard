-- Add user-derived key metadata to FastAuth sign events.
ALTER TABLE "public"."fastauth_sign_events"
  ADD COLUMN "user_sub" TEXT,
  ADD COLUMN "user_key_path" TEXT,
  ADD COLUMN "user_domain_id" INTEGER,
  ADD COLUMN "user_derived_public_key" TEXT;

CREATE INDEX "fastauth_sign_events_user_derived_public_key_block_timestamp_idx"
  ON "public"."fastauth_sign_events"("user_derived_public_key", "block_timestamp");

-- Add optional key metadata to public-key account links.
ALTER TABLE "public"."fastauth_public_key_accounts"
  ADD COLUMN "key_path" TEXT,
  ADD COLUMN "predecessor_id" TEXT,
  ADD COLUMN "domain_id" INTEGER;

CREATE INDEX "fastauth_public_key_accounts_key_path_idx"
  ON "public"."fastauth_public_key_accounts"("key_path");
