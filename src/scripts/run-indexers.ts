import "dotenv/config";

import { runAllIndexers } from "../lib/indexers/run-all";

async function main() {
  const results = await runAllIndexers();

  console.table(results);

  const hasError = results.some((result) => result.status === "error");
  if (hasError) {
    process.exitCode = 1;
  }
}

void main();
