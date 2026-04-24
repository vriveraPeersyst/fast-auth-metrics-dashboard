-- CreateTable
CREATE TABLE "public"."fastauth_chain_health_snapshots" (
    "id" SERIAL NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chain_head" BIGINT NOT NULL,
    "window_start_height" BIGINT NOT NULL,
    "window_end_height" BIGINT NOT NULL,
    "window_blocks" INTEGER NOT NULL,
    "total_transactions" INTEGER NOT NULL,
    "successful_transactions" INTEGER NOT NULL,
    "failed_transactions" INTEGER NOT NULL,
    "distinct_relayers" INTEGER NOT NULL,
    "last_success_timestamp" TIMESTAMP(3),
    "last_success_tx_hash" TEXT,

    CONSTRAINT "fastauth_chain_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fastauth_chain_health_snapshots_computed_at_idx" ON "public"."fastauth_chain_health_snapshots"("computed_at");
