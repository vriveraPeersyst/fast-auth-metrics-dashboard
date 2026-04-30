-- CreateTable
CREATE TABLE "public"."fastauth_contract_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "contract_id" TEXT NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL,
    "balance_yocto" TEXT,
    "storage_usage" BIGINT,
    "code_hash" TEXT,
    "full_access_keys" INTEGER,
    "config_json" JSONB NOT NULL,
    "source_metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fastauth_contract_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fastauth_contract_snapshots_contract_id_snapshot_at_idx" ON "public"."fastauth_contract_snapshots"("contract_id", "snapshot_at");
