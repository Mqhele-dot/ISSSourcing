#!/usr/bin/env node
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const port = process.env.PORT || "5000";
const url = `http://127.0.0.1:${port}`;

function runNpm(args) {
  const result = spawnSync(process.platform === "win32" ? "cmd.exe" : npmCmd, process.platform === "win32" ? ["/d", "/s", "/c", [npmCmd, ...args].join(" ")] : args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync("dist/public/index.html")) {
  console.log("dist/public/index.html not found; building local static app first.");
  runNpm(["run", "build"]);
}

fs.writeFileSync(".local-dev-url", `APP_URL=${url}\nPORT=${port}\nMODE=static\n`, "utf8");

console.log("ISSSourcing local static server");
console.log(`URL: ${url}`);
console.log("Mode: development runtime + built static client (avoids Vite dependency scan on Windows/OneDrive)");

const useShell = process.platform === "win32";
const child = spawn(useShell ? "cmd.exe" : npmCmd, useShell ? ["/d", "/s", "/c", `${npmCmd} run dev`] : ["run", "dev"], {
  cwd: process.cwd(),
  shell: false,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "development",
    RUNTIME_DEPLOYMENT: process.env.RUNTIME_DEPLOYMENT || "development",
    HOST: process.env.HOST || "127.0.0.1",
    PORT: port,
    LOCAL_DEV_STATIC: "1",
    ALLOW_UNVERIFIED_EMAIL_LOGIN: process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN || "true",
    DEV_TEST_LOGIN_ENABLED: process.env.DEV_TEST_LOGIN_ENABLED || "true",
    SKIP_PRODUCT_ONBOARDING: process.env.SKIP_PRODUCT_ONBOARDING || "true",
    ALLOW_SETUP_SKIP: process.env.ALLOW_SETUP_SKIP || "true",
    AUTO_SEED_ON_EMPTY_DB: process.env.AUTO_SEED_ON_EMPTY_DB || "true",
  },
});

function shutdown() {
  child.kill();
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
