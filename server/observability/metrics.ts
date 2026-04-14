type CounterName =
  | "requests.total"
  | "requests.errors"
  | "exports.jobs.queued"
  | "exports.jobs.running"
  | "exports.jobs.succeeded"
  | "exports.jobs.failed"
  | "ap.approval.failures"
  | "ap.release.failures";

const counters = new Map<CounterName, number>();
const latencySamples: number[] = [];

export function incrementMetric(name: CounterName, value = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + value);
}

export function observeRequestLatency(durationMs: number): void {
  latencySamples.push(durationMs);
  if (latencySamples.length > 200) {
    latencySamples.shift();
  }
}

export function getMetricsSnapshot() {
  const samples = [...latencySamples];
  const avgLatencyMs =
    samples.length > 0 ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : 0;

  return {
    counters: Object.fromEntries(counters.entries()),
    latency: {
      sampleSize: samples.length,
      averageMs: avgLatencyMs,
      maxMs: samples.length > 0 ? Math.max(...samples) : 0,
    },
  };
}
