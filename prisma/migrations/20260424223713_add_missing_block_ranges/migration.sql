-- CreateTable
CREATE TABLE "public"."missing_block_ranges" (
    "id" BIGSERIAL NOT NULL,
    "start_height" BIGINT NOT NULL,
    "end_height" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "completed_up_to" BIGINT,
    "completed_down_to" BIGINT,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missing_block_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "missing_block_ranges_status_idx" ON "public"."missing_block_ranges"("status");

-- CreateIndex
CREATE UNIQUE INDEX "missing_block_ranges_start_height_end_height_key" ON "public"."missing_block_ranges"("start_height", "end_height");
