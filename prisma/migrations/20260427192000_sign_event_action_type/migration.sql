-- AlterTable
ALTER TABLE "public"."fastauth_sign_events"
    ADD COLUMN "sign_action_type" TEXT;

-- CreateIndex
CREATE INDEX "fastauth_sign_events_sign_action_type_block_timestamp_idx"
    ON "public"."fastauth_sign_events"("sign_action_type", "block_timestamp");
