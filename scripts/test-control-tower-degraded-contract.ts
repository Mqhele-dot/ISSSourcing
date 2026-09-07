import assert from "node:assert/strict";
import express from "express";

process.env.OPERATIONS_DEGRADED = "true";

const { registerOperationalRoutes } = await import("../server/operations-routes.ts");

function ensureAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.user = { username: "admin", role: "admin" };
  res.locals.organizationId = 1;
  next();
}

async function main() {
  const app = express();
  app.use(express.json());
  registerOperationalRoutes(app, { ensureAuthenticated });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object" && "port" in address, "Test server should expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const overview = await fetch(`${baseUrl}/api/control-tower/overview`);
    assert.equal(overview.status, 503, "overview should fail closed when operations are degraded");
    assert.equal(overview.headers.get("x-invtrack-fallback"), "degraded");
    const overviewJson = await overview.json();
    assert.equal(overviewJson?.ok, false, "overview should return error envelope");
    assert.equal(overviewJson?.error?.code, "CONTROL_TOWER_UNAVAILABLE");

    const dashboard = await fetch(`${baseUrl}/api/dashboard/control-tower?days=30&area=inventory`);
    assert.equal(dashboard.status, 503, "dashboard should fail closed when operations are degraded");
    assert.equal(dashboard.headers.get("x-invtrack-fallback"), "degraded");
    const dashboardJson = await dashboard.json();
    assert.equal(dashboardJson?.ok, false, "dashboard should return error envelope");
    assert.equal(dashboardJson?.error?.code, "CONTROL_TOWER_UNAVAILABLE");
    assert.equal(dashboardJson?.error?.details?.businessArea, "inventory");
    assert.equal(dashboardJson?.error?.details?.trendDays, 30);

    console.log("test-control-tower-degraded-contract: all checks passed.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
