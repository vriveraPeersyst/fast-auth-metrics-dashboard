-- AlterTable
ALTER TABLE "public"."fastauth_user_transactions"
    ADD COLUMN "meta_wrapped" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "value_usd" DECIMAL(20, 4);

-- CreateIndex
CREATE INDEX "fastauth_user_transactions_value_usd_idx"
    ON "public"."fastauth_user_transactions"("value_usd");
