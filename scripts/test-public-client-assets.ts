import assert from "node:assert/strict";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { get } from "node:http";
import { pathToFileURL } from "node:url";
import { registerPublicClientAssets, resolveBuiltClientPath } from "../server/bootstrap/public-client-assets";

const root = await mkdtemp(path.join(os.tmpdir(), "iss-public-assets-test-"));
const app = express();
const server = app.listen(0, "127.0.0.1");
try {
  const packagedPublic = path.join(root, "packaged", "dist", "public");
  await mkdir(packagedPublic, { recursive: true }); await writeFile(path.join(packagedPublic, "index.html"), "packaged shell");
  const previousDirectory = process.cwd();
  try {
    process.chdir(os.tmpdir());
    for (const entry of [path.join(root, "packaged", "dist", "index.js"), path.join(root, "packaged", "dist", "runtime", "server", "bootstrap", "public-client-assets.js")]) {
      assert.equal(resolveBuiltClientPath(pathToFileURL(entry).href), packagedPublic, "Packaged assets resolve relative to both supported build layouts, not the launch directory");
    }
  } finally { process.chdir(previousDirectory); }
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "app.js"), "window.publicAssetLoaded=true;");
  await writeFile(path.join(root, "assets", "app.css"), "body{color:black}");
  for (const file of ["bootstrap-recovery.js", "bootstrap-recovery.css"]) await writeFile(path.join(root, file), await readFile(path.resolve("client/public", file)));
  for (const file of ["sw.js", "manifest.webmanifest"]) await writeFile(path.join(root, file), "public artifact");
  await writeFile(path.join(root, "index.html"), "not served by early middleware");
  await writeFile(path.join(root, "private.txt"), "not exposed");
  app.use((_req, res, next) => { res.setHeader("X-Request-Id", randomUUID()); next(); });
  app.use(helmet());
  registerPublicClientAssets(app, root);
  // Test-owned HTML only: exercise the real recovery script with a deliberately
  // missing module, without weakening production HTML/session routing.
  app.get("/browser-fixture", (_req, res) => res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bootstrap-recovery.css"><script src="/bootstrap-recovery.js" defer></script></head><body><main id="bootstrap-recovery" aria-labelledby="bootstrap-heading"><h1 id="bootstrap-heading">Loading ISSSourcing…</h1><p id="bootstrap-message">Loading</p><button id="bootstrap-reload" type="button">Reload app</button></main><script src="/assets/app.js" defer></script><script src="/assets/missing.js" defer></script></body></html>`));
  let sessionAttempts = 0;
  app.use((_req, res) => { sessionAttempts++; res.status(503).json({ message: "Session service unavailable", requestId: res.getHeader("X-Request-Id") }); });
  if (!server.listening) await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  for (const route of ["/assets/app.js", "/assets/app.css", "/bootstrap-recovery.js", "/bootstrap-recovery.css", "/manifest.webmanifest", "/sw.js"]) {
    const response = await fetch(base + route, { headers: { Cookie: "connect.sid=stale-session" } });
    assert.equal(response.status, 200, route); assert.ok(response.headers.get("content-security-policy"));
    assert.ok(response.headers.get("x-request-id")); assert.equal(response.headers.get("set-cookie"), null); await response.text();
  }
  assert.equal(sessionAttempts, 0, "Public assets must not load/deserialize sessions");
  const head = await fetch(base + "/assets/app.js", { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  const etag = head.headers.get("etag"); assert.ok(etag);
  // fetch adds Cache-Control:no-cache for conditional requests; use an actual
  // browser-style conditional HTTP request to exercise server freshness.
  const cachedStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(base + "/assets/app.js", { headers: { "If-None-Match": etag } }, response => { response.resume(); response.once("end", () => resolve(response.statusCode)); }).once("error", reject);
  });
  assert.equal(cachedStatus, 304);
  for (const route of ["/assets/missing.js", "/assets/.env", "/assets/%2e%2e%2fprivate.txt"]) {
    const response = await fetch(base + route); assert.ok([403, 404].includes(response.status), `${route}: ${response.status}`);
    const body = await response.text(); assert.equal(body.includes(root), false); assert.equal(body.includes("not exposed"), false);
  }
  assert.equal(sessionAttempts, 0, "Missing/stale assets must not hit the database or return SPA HTML");
  for (const route of ["/api/user", "/api/audit/events", "/uploads/private.pdf", "/index.html", "/private.txt", "/admin/system-diagnostics", "/bootstrap-recovery.js/extra"]) {
    const response = await fetch(base + route); assert.equal(response.status, 503, route); assert.equal((await response.json()).message, "Session service unavailable");
  }
  assert.equal(sessionAttempts, 7);
  const post = await fetch(base + "/bootstrap-recovery.js", { method: "POST" }); assert.equal(post.status, 405); await post.text();
  assert.equal(sessionAttempts, 7);
  if (process.argv.includes("--browser")) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome", headless: true });
    const artifacts = path.resolve("output/playwright", `public-assets-outage-${randomUUID()}`);
    await mkdir(artifacts, { recursive: true });
    try {
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport });
        await context.tracing.start({ screenshots: true, snapshots: true });
        const page = await context.newPage(), errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        const route = "/browser-fixture?filter=retained#recovery";
        await page.goto(base + route);
        await page.getByRole("heading", { name: "The app could not finish loading" }).waitFor();
        assert.equal(await page.evaluate(() => (window as Window & { publicAssetLoaded?: boolean }).publicAssetLoaded), true);
        assert.match(await page.locator("#bootstrap-message").innerText(), /An app file could not be loaded/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        const attemptsBeforeProbe = sessionAttempts;
        assert.equal(await page.evaluate(async () => (await fetch("/api/user")).status), 503);
        assert.equal(sessionAttempts, attemptsBeforeProbe + 1);
        const reload = page.getByRole("button", { name: "Reload app" });
        await reload.focus(); assert.equal(await reload.evaluate(element => element === document.activeElement), true);
        await Promise.all([page.waitForNavigation(), page.keyboard.press("Enter")]);
        assert.equal(page.url(), base + route, "Explicit reload preserves filters and fragment");
        await page.getByRole("heading", { name: "The app could not finish loading" }).waitFor();
        assert.deepEqual(errors, [], "Injected asset/API failures must not cause unexpected JavaScript exceptions");
        await page.screenshot({ path: path.join(artifacts, `${viewport.width}px.png`), fullPage: true });
        await context.tracing.stop({ path: path.join(artifacts, `${viewport.width}px-trace.zip`) });
        await context.close();
      }
      console.log(JSON.stringify({ browserStatus: "passed", viewports: [1280, 390], artifacts, scope: "Isolated session-outage recovery regression, not full application sign-off", expectedFailures: ["missing asset 404", "authenticated API session outage 503"], unexpectedJavaScriptErrors: 0 }));
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ status: "passed", checks: ["bundled/transpiled assets resolve independently of cwd", "public modules and recovery assets survive session failure", "security and request headers retained", "stale cookies do not trigger database reads", "missing assets return safe errors not SPA HTML", "HEAD/cache validation", "traversal/dotfile denial", "API/uploads/HTML/navigation still require session middleware", "non-read methods refused"], businessDatabaseChanged: false }));
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith("iss-public-assets-test-"));
  await rm(root, { recursive: true, force: true });
}
