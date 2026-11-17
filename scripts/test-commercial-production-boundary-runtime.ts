import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { registerProductionReleaseBoundary } from "../server/production-release-boundary.ts";

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: { area?: string; productionReleaseScope?: string };
  };
};

async function main() {
  const app = express();
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.isAuthenticated = () => true;
    res.locals.requestId = "commercial-boundary-runtime-test";
    next();
  });

  registerProductionReleaseBoundary(
    app,
    { ensureAuthenticated: (_req, _res, next) => next() },
    {
      productionRuntime: true,
      scope: "procurement",
      resolveFeatureFlags: async () => ({}),
    },
  );

  app.all("/api/requisitions", (_req, res) => res.status(200).json({ available: true }));
  app.all("/api/sourcing/events", (_req, res) => res.status(200).json({ available: true }));
  app.all("/api/inventory", (_req, res) => res.status(200).json({ available: true }));
  app.all("/api/mobile/receive", (_req, res) => res.status(200).json({ available: true }));
  app.all("/api/mobile/counts", (_req, res) => res.status(200).json({ available: true }));
  app.all("/api/shipments", (_req, res) => res.status(200).json({ available: true }));
  app.all("/api/accounts-payable", (_req, res) => res.status(200).json({ available: true }));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const request = (path: string, method = "GET") => fetch(`http://127.0.0.1:${port}${path}`, { method });

  try {
    const scopeResponse = await request("/api/release-scope");
    assert.equal(scopeResponse.status, 200);
    const scope = await scopeResponse.json() as { data: { boundary: string; productionRuntime: boolean; previewMode: boolean; modules: Record<string, boolean> } };
    assert.equal(scope.data.boundary, "procurement");
    assert.equal(scope.data.productionRuntime, true);
    assert.equal(scope.data.previewMode, false);
    assert.equal(scope.data.modules.procurement, true);
    for (const area of ["inventory", "receiving", "logistics", "finance", "mobile_operations"]) {
      assert.equal(scope.data.modules[area], false, `${area} must remain outside the production boundary`);
    }

    for (const path of ["/api/requisitions", "/api/sourcing/events"]) {
      const response = await request(path, "POST");
      assert.equal(response.status, 200, `${path} must remain available`);
    }

    const inventoryRead = await request("/api/inventory");
    assert.equal(inventoryRead.status, 200, "read-only inventory reference access must remain available");

    const blocked: Array<[string, string]> = [
      ["/api/inventory", "inventory"],
      ["/api/mobile/receive", "receiving"],
      ["/api/mobile/counts", "mobile_operations"],
      ["/api/shipments", "logistics"],
      ["/api/accounts-payable", "finance"],
    ];
    for (const [path, area] of blocked) {
      const response = await request(path, "POST");
      assert.equal(response.status, 403, `${path} must be production blocked`);
      const body = await response.json() as ErrorEnvelope;
      assert.equal(body.error.code, "FEATURE_NOT_PRODUCTION_APPROVED");
      assert.equal(body.error.details?.area, area);
      assert.equal(body.error.details?.productionReleaseScope, "procurement");
      assert.ok(body.error.hint, `${path} must include controlled repair guidance`);
      assert.doesNotMatch(body.error.message, /stack|database|sql/i);
    }

    console.log("Commercial procurement production boundary runtime proof passed.");
  } finally {
    server.close();
    await once(server, "close");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
