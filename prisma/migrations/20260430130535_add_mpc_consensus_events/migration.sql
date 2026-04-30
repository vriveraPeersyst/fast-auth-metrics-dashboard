-- CreateTable
CREATE TABLE "public"."mpc_consensus_events" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "event_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "execution_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpc_consensus_events_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex
CREATE INDEX "mpc_consensus_events_block_timestamp_idx" ON "public"."mpc_consensus_events"("block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_consensus_events_event_type_block_timestamp_idx" ON "public"."mpc_consensus_events"("event_type", "block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_consensus_events_category_block_timestamp_idx" ON "public"."mpc_consensus_events"("category", "block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_consensus_events_actor_id_block_timestamp_idx" ON "public"."mpc_consensus_events"("actor_id", "block_timestamp");
