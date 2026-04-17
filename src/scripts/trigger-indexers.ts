import { createHmac } from "node:crypto";

import "dotenv/config";

type CliOptions = {
  url?: string;
  dryRun: boolean;
  timeoutMs: number;
};

function printHelp(): void {
  console.log(`Usage: pnpm indexers:trigger [options]

Options:
  --url <url>           Full endpoint URL (default: DASHBOARD_BASE_URL + /api/indexers/run)
  --timeout-ms <ms>     Request timeout in milliseconds (default: 10000)
  --dry-run             Print generated headers and curl command without sending
  --help                Show this help

Environment variables:
  INDEXER_CRON_SECRET   Required. HMAC secret used to sign request
  DASHBOARD_BASE_URL    Required unless --url is provided
`);
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    timeoutMs: 10_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--url") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --url.");
      }

      options.url = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--timeout-ms") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --timeout-ms.");
      }

      const timeoutMs = Number(value);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive number.");
      }

      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      const value = arg.slice("--timeout-ms=".length);
      const timeoutMs = Number(value);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive number.");
      }

      options.timeoutMs = timeoutMs;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveEndpoint(urlFromArgs: string | undefined): URL {
  if (urlFromArgs) {
    return new URL(urlFromArgs);
  }

  const baseUrl = process.env.DASHBOARD_BASE_URL;
  if (!baseUrl) {
    throw new Error("DASHBOARD_BASE_URL must be set when --url is not provided.");
  }

  return new URL("/api/indexers/run", baseUrl);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const secret = process.env.INDEXER_CRON_SECRET;

  if (!secret) {
    throw new Error("INDEXER_CRON_SECRET is required.");
  }

  const endpoint = resolveEndpoint(options.url);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}:${endpoint.pathname}`)
    .digest("hex");

  if (options.dryRun) {
    console.log(`Endpoint: ${endpoint.toString()}`);
    console.log(`x-indexer-ts: ${timestamp}`);
    console.log(`x-indexer-signature: ${signature}`);
    console.log("\nCurl preview:");
    console.log(
      `curl -X POST "${endpoint.toString()}" -H "x-indexer-ts: ${timestamp}" -H "x-indexer-signature: ${signature}"`,
    );
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-indexer-ts": timestamp,
      "x-indexer-signature": signature,
    },
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    console.error(`Indexer trigger failed (${response.status}).`);
    if (responseBody) {
      console.error(responseBody);
    }
    process.exit(1);
  }

  console.log(`Indexer trigger succeeded (${response.status}).`);
  if (responseBody) {
    console.log(responseBody);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown trigger error";
  console.error(message);
  process.exit(1);
});
