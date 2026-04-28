-- AlterTable: add per-token movement arrays for "Top tokens" analytics.
ALTER TABLE "public"."fastauth_user_transactions"
    ADD COLUMN "token_symbols"    TEXT[]            NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "token_amounts"    TEXT[]            NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "token_decimals"   INTEGER[]         NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "token_values_usd" DECIMAL(20, 8)[]  NOT NULL DEFAULT ARRAY[]::DECIMAL(20, 8)[];
