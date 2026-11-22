import type { Express } from "express";
import { getBuildInfo } from "../lib/build-info";
import { getMetricsSnapshot } from "../observability/metrics";

export function registerMetricsRoute(app: Express): void {
  app.get("/metrics", (_req, res) => {
    res.json({
      ok: true,
      data: {
        build: getBuildInfo(),
        metrics: getMetricsSnapshot(),
      },
    });
  });
}
