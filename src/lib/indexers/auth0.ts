import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import type { IndexerRunResult } from "@/lib/indexers/types";

type Auth0LogPayload = {
  _id?: string;
  date?: string;
  type?: string;
  description?: string;
  client_id?: string;
  client_name?: string;
  connection?: string;
  user_id?: string;
  [key: string]: unknown;
};

const CHECKPOINT_KEY = "auth0_logs_last_id";

const requiredEnv = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_AUDIENCE",
  "USER_HASH_SALT",
] as const;

function hasConfiguredValue(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  // Treat template placeholders from .env.example as missing configuration.
  return !(normalized.includes("replace-with") || normalized.includes("your-"));
}

function getMissingEnv(): string[] {
  return requiredEnv.filter((key) => !hasConfiguredValue(process.env[key]));
}

function hashUserId(userId: string): string {
  const salt = process.env.USER_HASH_SALT ?? "";

  return createHash("sha256").update(`${salt}:${userId}`).digest("hex");
}

function toSafePayload(log: Auth0LogPayload): Prisma.InputJsonObject {
  return {
    log_id: log._id ?? null,
    date: log.date ?? null,
    type: log.type ?? null,
    description: log.description ?? null,
    client_id: log.client_id ?? null,
    client_name: log.client_name ?? null,
    connection: log.connection ?? null,
  };
}

async function getAccessToken(): Promise<string> {
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      audience: process.env.AUTH0_AUDIENCE,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    throw new Error(`Auth0 token request failed (${response.status}).`);
  }

  const payload = (await response.json()) as { access_token?: string };

  if (!payload.access_token) {
    throw new Error("Auth0 token response does not contain access_token.");
  }

  return payload.access_token;
}

export async function collectAuth0Logs(prisma: PrismaClient): Promise<IndexerRunResult> {
  const missingEnv = getMissingEnv();

  if (missingEnv.length > 0) {
    return {
      source: "auth0",
      status: "skipped",
      details: `Missing env vars: ${missingEnv.join(", ")}`,
    };
  }

  try {
    const accessToken = await getAccessToken();
    const checkpoint = await prisma.indexerCheckpoint.findUnique({
      where: { key: CHECKPOINT_KEY },
    });

    const pageSize = 100;
    let from = checkpoint?.value ?? null;
    let totalInserted = 0;
    let totalFetched = 0;

    while (true) {
      const query = new URLSearchParams();

      if (from) {
        query.set("from", from);
        query.set("take", String(pageSize));
      } else {
        query.set("sort", "date:1");
        query.set("per_page", String(pageSize));
        query.set("page", "0");
      }

      const logsResponse = await fetch(
        `https://${process.env.AUTH0_DOMAIN}/api/v2/logs?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!logsResponse.ok) {
        throw new Error(`Auth0 logs request failed (${logsResponse.status}).`);
      }

      const logs = (await logsResponse.json()) as Auth0LogPayload[];

      if (!Array.isArray(logs) || logs.length === 0) {
        break;
      }

      totalFetched += logs.length;

      const validLogs = logs.filter((log) => log._id && log.date && log.type);

      if (validLogs.length === 0) {
        return {
          source: "auth0",
          status: "error",
          inserted: totalInserted,
          details: "Fetched logs did not contain required fields; checkpoint not advanced.",
        };
      }

      const lastLog = validLogs[validLogs.length - 1];

      const insertedCount = await prisma.$transaction(async (tx) => {
        const insertResult = await tx.auth0Log.createMany({
          data: validLogs.map((log) => ({
            logId: log._id as string,
            timestamp: new Date(log.date as string),
            type: log.type as string,
            description: log.description ?? null,
            clientId: log.client_id ?? null,
            clientName: log.client_name ?? null,
            connection: log.connection ?? null,
            userIdHash: log.user_id ? hashUserId(log.user_id) : null,
            payload: toSafePayload(log),
          })),
          skipDuplicates: true,
        });

        await tx.indexerCheckpoint.upsert({
          where: { key: CHECKPOINT_KEY },
          create: {
            key: CHECKPOINT_KEY,
            value: lastLog._id as string,
          },
          update: {
            value: lastLog._id as string,
          },
        });

        return insertResult.count;
      });

      totalInserted += insertedCount;
      from = lastLog._id as string;

      if (logs.length < pageSize) {
        break;
      }
    }

    return {
      source: "auth0",
      status: "ok",
      inserted: totalInserted,
      details:
        totalFetched === 0
          ? "No new logs."
          : `Processed ${totalFetched} logs, inserted ${totalInserted} rows with durable checkpoints.`,
    };
  } catch (error) {
    return {
      source: "auth0",
      status: "error",
      details: error instanceof Error ? error.message : "Unknown Auth0 collector error.",
    };
  }
}
