export const METRIC_VALUES = ["created", "closed", "net"] as const;

export type MetricValue = (typeof METRIC_VALUES)[number];

const DEFAULT_METRICS: MetricValue[] = ["created"];

export function normalizeMetrics(metrics: Array<string | null | undefined>):
  MetricValue[] {
  const normalized = new Set<MetricValue>();

  for (const raw of metrics) {
    if (!raw) continue;
    const value = raw.trim().toLowerCase();
    if ((METRIC_VALUES as readonly string[]).includes(value)) {
      normalized.add(value as MetricValue);
    }
  }

  const ordered = METRIC_VALUES.filter((value) => normalized.has(value));
  return ordered.length > 0 ? ordered : [...DEFAULT_METRICS];
}

export function parseMetricsParam(params: URLSearchParams): MetricValue[] {
  const raw = params.get("metrics");
  if (raw) {
    return normalizeMetrics(raw.split(","));
  }

  const showClosed = params.get("showClosed");
  if (showClosed === "true" || showClosed === "1") {
    return ["created", "closed"];
  }

  return [...DEFAULT_METRICS];
}

export function serializeMetricsParam(metrics: MetricValue[]): string | null {
  const normalized = normalizeMetrics(metrics);
  if (normalized.length === 1 && normalized[0] === "created") {
    return null;
  }
  return normalized.join(",");
}
