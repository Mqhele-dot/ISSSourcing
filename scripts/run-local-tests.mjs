import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { assertDisposableTestDatabase } from "./test-database-safety.mjs";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const runtimeDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const suites = {
  sourcing: [
    ["run", "test:commercial-procurement-foundation"],
    ["run", "test:sourcing-workflow"],
  ],
  expandedWave7: [
    ["run", "test:database-settings-hardening"],
    ["run", "test:exception-assignment-client"],
    ["run", "test:exception-status-policy"],
    ["run", "test:procurement-line-report-filters"],
    ["run", "test:control-tower-degraded-contract"],
    ["run", "test:manual-procurement-lines-runtime"],
    ["run", "test:procurement-reporting-runtime"],
    ["run", "test:approval-policy-runtime-hardening"],
    ["run", "test:diagnostics-runtime-workspaces"],
    ["run", "test:expanded-cross-tenant-proof"],
    ["run", "test:expanded-permission-matrix"],
  ],
  crossPath: [
    ["run", "test:cross-path-contracts"],
    ["run", "test:ap-controls"],
    ["run", "test:sourcing-workflow"],
    ["run", "test:expanded-cross-tenant-proof"],
    ["run", "test:expanded-permission-matrix"],
  ],
  quick: [
    ["run", "check"],
    ["run", "lint"],
    ["run", "test:diagnostics"],
    ["run", "test:route-diagnostics"],
    ["run", "test:master-data-propagation"],
  ],
  delta: [
    ["run", "check"],
    ["run", "lint"],
    ["run", "test:diagnostics"],
    ["run", "test:route-diagnostics"],
    ["run", "test:master-data-propagation"],
    ["run", "test:master-data-integration"],
    ["run", "test:purchase-order-endpoints"],
    ["run", "test:ap-workflow"],
    ["run", "test:production-workflow-proof"],
    ["run", "test:requisition-line-mdm-propagation"],
    ["run", "test:requisition-line-mdm-flow"],
    ["run", "test:mdm-dependency-runtime"],
    ["run", "test:po-receiving-inventory-flow"],
    ["run", "test:ap-po-grn-matching-flow"],
    ["run", "test:control-plane-runtime"],
    ["run", "test:core-screen-workflow-contracts"],
    ["run", "test:control-plane-screen-contracts"],
    ["run", "release:gate:delta"],
  ],
  productionSmoke: [
    ["run", "test:master-data-propagation"],
    ["run", "test:purchase-order-endpoints"],
    ["run", "test:ap-workflow"],
    ["run", "test:production-workflow-proof"],
    ["run", "test:requisition-line-mdm-propagation"],
    ["run", "test:requisition-line-mdm-flow"],
    ["run", "test:mdm-dependency-runtime"],
    ["run", "test:po-receiving-inventory-flow"],
    ["run", "test:ap-po-grn-matching-flow"],
    ["run", "test:control-plane-runtime"],
    ["run", "test:core-screen-workflow-contracts"],
    ["run", "test:control-plane-screen-contracts"],
    ["run", "test:diagnostics"],
  ],
};

function hasFlag(name) {
  return process.argv.includes(name);
}

function suiteName() {
  if (hasFlag("--cross-path")) return "crossPath";
  if (hasFlag("--expanded-wave7")) return "expandedWave7";
  if (hasFlag("--sourcing")) return "sourcing";
  if (hasFlag("--production-smoke")) return "productionSmoke";
  if (hasFlag("--delta")) return "delta";
  return "quick";
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : command, process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: runtimeDatabaseUrl,
        TEST_DATABASE_URL: runtimeDatabaseUrl,
        REQUIRE_DISPOSABLE_TEST_DATABASE: "1",
        BASE_URL,
        PORT,
        TEST_REQUIRE_SERVER: "1",
        ...options.env,
      },
      shell: false,
      stdio: options.stdio || "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function waitForReady(timeoutMs = Number(process.env.LOCAL_TEST_READY_TIMEOUT_MS || 120_000)) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/ready`, { cache: "no-store" });
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Local app did not become ready at ${BASE_URL}/api/ready within ${timeoutMs / 1000}s`);
}

async function existingDisposableServerIsReady() {
  try {
    const res = await fetch(`${BASE_URL}/api/ready`, { cache: "no-store" });
    if (!res.ok || res.headers.get("x-test-database-mode") !== "disposable") return false;
    if (selectedSuite === "delta") {
      const staticProbe = await fetch(`${BASE_URL}/analytics/export-center`, { cache: "no-store" });
      return staticProbe.ok && staticProbe.headers.get("content-type")?.includes("text/html") === true;
    }
    return true;
  } catch {
    return false;
  }
}

function startServer() {
  const serverEnv =
    selectedSuite === "delta"
      ? { LOCAL_DEV_STATIC: "1" }
      : { LOCAL_TEST_API_ONLY: "1" };
  const child = spawn(process.platform === "win32" ? "cmd.exe" : npmCmd, process.platform === "win32" ? ["/d", "/s", "/c", `${npmCmd} run dev`] : ["run", "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: runtimeDatabaseUrl,
      TEST_DATABASE_URL: runtimeDatabaseUrl,
      REQUIRE_DISPOSABLE_TEST_DATABASE: "1",
      PORT,
      ...serverEnv,
    },
    shell: false,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Local dev server exited early with ${code}`);
    }
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        killer.kill();
        resolve();
      }, 5_000);
      killer.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      killer.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return;
  }
  child.kill("SIGTERM");
}

let shuttingDown = false;
const selectedSuite = suiteName();
const selectedCommands = suites[selectedSuite];
let server = null;

try {
  console.log(`Local test runner`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Suite: ${selectedSuite}`);

  if (["sourcing", "expandedWave7", "crossPath", "delta", "productionSmoke"].includes(selectedSuite)) {
    assertDisposableTestDatabase(runtimeDatabaseUrl);
  }

  if (!hasFlag("--no-server")) {
    if (await existingDisposableServerIsReady()) {
      console.log("Using an existing disposable-database app at the requested BASE_URL.");
    } else {
      server = startServer();
      await waitForReady();
      console.log("Local app is ready.");
    }
  }

  for (const args of selectedCommands) {
    console.log(`\n> ${npmCmd} ${args.join(" ")}`);
    await run(npmCmd, args);
  }

  if (selectedSuite === "crossPath") {
    const evidence = {
      schemaVersion: 1,
      suite: "cross-path-runtime",
      passed: true,
      completedAt: new Date().toISOString(),
      database: assertDisposableTestDatabase(runtimeDatabaseUrl),
      baseUrl: BASE_URL,
      proofs: [
        "duplicate and legacy paths enforce the permission contracts locked by the AST suite",
        "AP admin overrides use authenticated actor role plus an explicit reason",
        "payment release and sourcing workflow requests are idempotent",
        "alternate procurement, AP, diagnostics, report, and export routes deny cross-tenant access",
        "equivalent governed mutations create tenant- and actor-scoped audit evidence",
        "report preview and export use the same tenant-scoped dataset path",
      ],
    };
    const evidencePath = path.join(process.cwd(), "artifacts", "cross-app-logic-runtime-evidence.json");
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  console.log(`\nLocal ${selectedSuite} test suite passed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  shuttingDown = true;
  await stopServer(server);
}
