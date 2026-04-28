-- AlterTable
ALTER TABLE "public"."fastauth_chain_health_snapshots"
    ADD COLUMN "guard_failed_transactions" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mpc_attempted_transactions" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mpc_failed_transactions" INTEGER NOT NULL DEFAULT 0;
