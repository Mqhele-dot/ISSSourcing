#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { probeUrl } from "./e2e-http-probe.mjs";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const port = process.env.PORT || "5000";
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;

function run(label, command, args) {
  const useShell = process.platform === "win32";
  const result = spawnSync(useShell ? [command, ...args].join(" ") : command, useShell ? [] : args, {
    encoding: "utf8",
    shell: useShell,
  });
  const ok = result.status === 0;
  console.log(`${ok ? "ok" : "FAIL"} ${label}${ok ? "" : ` (${result.stderr || result.stdout || "failed"})`}`);
  return ok;
}

function tcpProbe(host, p, timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(p) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

console.log("InvTrack local doctor\n");
let ok = true;
ok = run("node", "node", ["--version"]) && ok;
ok = run("npm", npmCmd, ["--version"]) && ok;
const hasTsc = fs.existsSync("node_modules/.bin/tsc") || fs.existsSync("node_modules/.bin/tsc.cmd");
console.log(`${hasTsc ? "ok" : "FAIL"} TypeScript binary ${hasTsc ? "exists" : "missing; run npm ci"}`);
ok = hasTsc && ok;
console.log(`${fs.existsSync(".env") ? "ok" : "WARN"} .env ${fs.existsSync(".env") ? "exists" : "is missing; npm run local:up will create one"}`);

const pgReachable = await tcpProbe("127.0.0.1", process.env.PGPORT || "5432");
console.log(`${pgReachable ? "ok" : "WARN"} postgres 127.0.0.1:${process.env.PGPORT || "5432"} ${pgReachable ? "reachable" : "not reachable"}`);

const ready = await probeUrl(`${baseUrl}/api/ready`, { timeoutMs: 3000 });
const auth = await probeUrl(`${baseUrl}/auth`, { timeoutMs: 3000 });
console.log(`${ready.ok ? "ok" : "WARN"} ${baseUrl}/api/ready ${ready.ok ? `HTTP ${ready.status}` : ready.error}`);
console.log(`${auth.ok ? "ok" : "WARN"} ${baseUrl}/auth ${auth.ok ? `HTTP ${auth.status}` : auth.error}`);

if (!ok) {
  console.log("\nRun npm ci, then npm run local:up.");
  process.exit(1);
}

console.log("\nLocal doctor complete.");
