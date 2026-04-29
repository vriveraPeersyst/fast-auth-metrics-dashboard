-- AlterTable: capture the receipt-level failure payload so the dashboard can
-- show *why* a tx failed (e.g. "Smart contract panicked: Request has timed
-- out.") rather than only what kind of failure it was. Set by collectFastAuthHealth
-- on any *_failure outcome; remains null for success / rpc_pending rows.
ALTER TABLE "public"."fastauth_health_tx"
    ADD COLUMN "failure_reason" TEXT;
