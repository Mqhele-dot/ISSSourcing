import { spawn } from "node:child_process";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const suites = {
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
    ["run", "test:diagnostics"],
  ],
};

function hasFlag(name) {
  return process.argv.includes(name);
}

function suiteName() {
  if (hasFlag("--production-smoke")) return "productionSmoke";
  if (hasFlag("--delta")) return "delta";
  return "quick";
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : command, process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args, {
      cwd: process.cwd(),
      env: { ...process.env, BASE_URL, PORT, ...options.env },
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

async function waitForReady(timeoutMs = 60_000) {
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

function startServer() {
  const serverEnv =
    selectedSuite === "delta"
      ? { LOCAL_DEV_STATIC: "1" }
      : { LOCAL_TEST_API_ONLY: "1" };
  const child = spawn(process.platform === "win32" ? "cmd.exe" : npmCmd, process.platform === "win32" ? ["/d", "/s", "/c", `${npmCmd} run dev`] : ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT, ...serverEnv },
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
  child.kill();
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
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

  if (!hasFlag("--no-server")) {
    server = startServer();
    await waitForReady();
    console.log("Local app is ready.");
  }

  for (const args of selectedCommands) {
    console.log(`\n> ${npmCmd} ${args.join(" ")}`);
    await run(npmCmd, args);
  }

  console.log(`\nLocal ${selectedSuite} test suite passed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  shuttingDown = true;
  await stopServer(server);
}
