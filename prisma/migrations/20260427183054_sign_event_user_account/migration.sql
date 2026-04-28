-- AlterTable
ALTER TABLE "public"."fastauth_sign_events"
    ADD COLUMN "user_account_id" TEXT;

-- CreateIndex
CREATE INDEX "fastauth_sign_events_user_account_id_block_timestamp_idx"
    ON "public"."fastauth_sign_events"("user_account_id", "block_timestamp");
