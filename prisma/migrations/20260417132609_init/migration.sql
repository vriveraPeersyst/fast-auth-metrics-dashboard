-- CreateTable
CREATE TABLE "public"."auth0_logs" (
    "log_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "client_id" TEXT,
    "client_name" TEXT,
    "connection" TEXT,
    "user_id_hash" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth0_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "public"."service_metrics_timeseries" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "service_name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "labels_json" JSONB NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_metrics_timeseries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."near_transactions" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT,
    "block_timestamp" TIMESTAMP(3),
    "signer_account_id" TEXT,
    "receiver_id" TEXT,
    "method_name" TEXT,
    "execution_status" TEXT,
    "failure_reason" TEXT,
    "gas_burnt" BIGINT,
    "attached_deposit_yocto" TEXT,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "near_transactions_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateTable
CREATE TABLE "public"."indexer_checkpoints" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_checkpoints_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "auth0_logs_timestamp_idx" ON "public"."auth0_logs"("timestamp");

-- CreateIndex
CREATE INDEX "auth0_logs_type_timestamp_idx" ON "public"."auth0_logs"("type", "timestamp");

-- CreateIndex
CREATE INDEX "service_metrics_timeseries_service_name_metric_name_timesta_idx" ON "public"."service_metrics_timeseries"("service_name", "metric_name", "timestamp");

-- CreateIndex
CREATE INDEX "near_transactions_block_height_idx" ON "public"."near_transactions"("block_height");
