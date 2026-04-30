-- CreateTable
CREATE TABLE "public"."mpc_nodes" (
    "account_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "total_responses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpc_nodes_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "public"."mpc_sign_requests" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "predecessor_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "path" TEXT,
    "scheme" TEXT NOT NULL,
    "payload_hex" TEXT NOT NULL,
    "domain_id" INTEGER,
    "key_version" INTEGER,
    "source" TEXT NOT NULL,
    "traffic_source" TEXT NOT NULL DEFAULT 'organic',
    "execution_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpc_sign_requests_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateTable
CREATE TABLE "public"."mpc_sign_responses" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "signer_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "payload_hex" TEXT NOT NULL,
    "execution_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpc_sign_responses_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateIndex
CREATE INDEX "mpc_nodes_last_seen_at_idx" ON "public"."mpc_nodes"("last_seen_at");

-- CreateIndex
CREATE INDEX "mpc_sign_requests_block_timestamp_idx" ON "public"."mpc_sign_requests"("block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_sign_requests_request_key_idx" ON "public"."mpc_sign_requests"("request_key");

-- CreateIndex
CREATE INDEX "mpc_sign_requests_predecessor_id_block_timestamp_idx" ON "public"."mpc_sign_requests"("predecessor_id", "block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_sign_requests_traffic_source_block_timestamp_idx" ON "public"."mpc_sign_requests"("traffic_source", "block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_sign_responses_block_timestamp_idx" ON "public"."mpc_sign_responses"("block_timestamp");

-- CreateIndex
CREATE INDEX "mpc_sign_responses_request_key_idx" ON "public"."mpc_sign_responses"("request_key");

-- CreateIndex
CREATE INDEX "mpc_sign_responses_signer_id_block_timestamp_idx" ON "public"."mpc_sign_responses"("signer_id", "block_timestamp");
