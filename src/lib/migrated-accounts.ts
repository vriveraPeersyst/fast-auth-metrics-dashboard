// Static count of accounts migrated from the legacy FastAuth backend that
// pre-date the indexer and don't appear in the `accounts` table until they
// sign on-chain. Snapshot shared by Adrià on 2026-05-04. Treated as a disjoint
// population from indexed accounts: total = indexed + migrated. Windowed
// metrics (firstSeen, active) intentionally exclude this number — we have no
// per-account timestamps for the migrated cohort.
//
// Bump this constant when a fresh count is shared. Both `dashboard-data.ts`
// (for the home page tiles) and `app/api/public/metrics/route.ts` (for the
// public landing page) read it from here so the two stay in sync.
export const MIGRATED_ACCOUNTS_TOTAL = 9_855_138;
