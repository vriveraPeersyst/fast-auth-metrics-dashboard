-- CreateTable
CREATE TABLE "public"."mpc_log_parse_skipped" (
    "tx_hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "skipped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mpc_log_parse_skipped_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex
CREATE INDEX "mpc_log_parse_skipped_source_skipped_at_idx" ON "public"."mpc_log_parse_skipped"("source", "skipped_at");
