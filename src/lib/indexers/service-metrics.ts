import type { PrismaClient } from "@prisma/client";

import type { IndexerRunResult } from "@/lib/indexers/types";

type ServiceConfig = {
  serviceName: string;
  endpoint: string;
  allowMetric: (metricName: string) => boolean;
};

type ParsedMetric = {
  metricName: string;
  labels: Record<string, string>;
  value: number;
};

function hasConfiguredBaseUrl(value: string | undefined): value is string {
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

function isCounterMetric(metricName: string): boolean {
  return metricName.endsWith("_total") || metricName === "sign_total" || metricName === "sign_failed";
}

const metricLinePattern =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;

function parseLabels(rawLabels: string | undefined): Record<string, string> {
  if (!rawLabels) {
    return {};
  }

  return rawLabels
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [rawKey, rawValue] = pair.split("=");

      if (!rawKey || !rawValue) {
        return acc;
      }

      acc[rawKey] = rawValue.replace(/^"|"$/g, "");
      return acc;
    }, {});
}

function parsePrometheusMetrics(payload: string): ParsedMetric[] {
  return payload
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(metricLinePattern);

      if (!match) {
        return null;
      }

      const metricName = match[1];
      const labels = parseLabels(match[3]);
      const value = Number(match[4]);

      if (Number.isNaN(value)) {
        return null;
      }

      return {
        metricName,
        labels,
        value,
      };
    })
    .filter((entry): entry is ParsedMetric => entry !== null);
}

function serviceConfigs(): ServiceConfig[] {
  const configs: ServiceConfig[] = [];

  if (hasConfiguredBaseUrl(process.env.RELAYER_BASE_URL)) {
    configs.push({
      serviceName: "relayer",
      endpoint: `${process.env.RELAYER_BASE_URL}/api/metrics`,
      allowMetric: (metricName) => metricName === "sign_total" || metricName === "sign_failed",
    });
  }

  if (hasConfiguredBaseUrl(process.env.CUSTOM_ISSUER_BASE_URL)) {
    configs.push({
      serviceName: "custom_issuer",
      endpoint: `${process.env.CUSTOM_ISSUER_BASE_URL}/metrics`,
      allowMetric: (metricName) => metricName.startsWith("custom_issuer_"),
    });
  }

  if (hasConfiguredBaseUrl(process.env.CUSTOM_ISSUER_GO_BASE_URL)) {
    configs.push({
      serviceName: "custom_issuer_go",
      endpoint: `${process.env.CUSTOM_ISSUER_GO_BASE_URL}/metrics`,
      allowMetric: (metricName) => metricName.startsWith("custom_issuer_go_"),
    });
  }

  return configs;
}

export async function collectServiceMetrics(
  prisma: PrismaClient,
): Promise<IndexerRunResult> {
  const configs = serviceConfigs();

  if (configs.length === 0) {
    return {
      source: "service_metrics",
      status: "skipped",
      details: "No service metrics base URLs configured.",
    };
  }

  try {
    const timestamp = new Date();
    let inserted = 0;

    for (const service of configs) {
      const response = await fetch(service.endpoint);

      if (!response.ok) {
        throw new Error(
          `Failed to scrape ${service.serviceName} (${response.status}) from ${service.endpoint}.`,
        );
      }

      const payload = await response.text();
      const metrics = parsePrometheusMetrics(payload).filter((metric) =>
        service.allowMetric(metric.metricName),
      );

      if (metrics.length === 0) {
        continue;
      }

      const uniqueMetricNames = [...new Set(metrics.map((metric) => metric.metricName))];
      const previousByMetric = new Map<string, number>();

      for (const metricName of uniqueMetricNames) {
        const previousSample = await prisma.serviceMetricSample.findFirst({
          where: {
            serviceName: service.serviceName,
            metricName,
          },
          orderBy: {
            timestamp: "desc",
          },
          select: {
            value: true,
          },
        });

        if (previousSample) {
          previousByMetric.set(metricName, previousSample.value);
        }
      }

      const samplesToInsert: Array<{
        timestamp: Date;
        serviceName: string;
        metricName: string;
        labels: Record<string, string>;
        value: number;
      }> = [];

      for (const metric of metrics) {
        samplesToInsert.push({
          timestamp,
          serviceName: service.serviceName,
          metricName: metric.metricName,
          labels: metric.labels,
          value: metric.value,
        });

        if (!isCounterMetric(metric.metricName)) {
          continue;
        }

        const previousValue = previousByMetric.get(metric.metricName);
        if (previousValue === undefined) {
          continue;
        }

        const rawDelta = metric.value - previousValue;
        const delta = rawDelta >= 0 ? rawDelta : metric.value;

        samplesToInsert.push({
          timestamp,
          serviceName: service.serviceName,
          metricName: `${metric.metricName}_delta`,
          labels: {
            ...metric.labels,
            counter_reset: rawDelta < 0 ? "true" : "false",
          },
          value: delta,
        });
      }

      await prisma.serviceMetricSample.createMany({
        data: samplesToInsert,
      });

      inserted += samplesToInsert.length;
    }

    return {
      source: "service_metrics",
      status: "ok",
      inserted,
      details: "Prometheus endpoints scraped.",
    };
  } catch (error) {
    return {
      source: "service_metrics",
      status: "error",
      details:
        error instanceof Error ? error.message : "Unknown service metrics collector error.",
    };
  }
}
