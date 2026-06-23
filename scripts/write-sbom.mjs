#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const localCache = path.join(repoRoot, ".npm-cache-audit");
const outputPath = path.join(repoRoot, "sbom.cdx.json");

mkdirSync(localCache, { recursive: true });

const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArgs = ["--cache", localCache, "sbom", "--sbom-format", "cyclonedx", "--package-lock-only"];
const commandArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd", ...npmArgs] : npmArgs;
const result = spawnSync(command, commandArgs, {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 25,
  env: {
    ...process.env,
    npm_config_cache: process.env.npm_config_cache || localCache,
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.stdout) {
  writeFileSync(outputPath, result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.signal) {
  console.error(`npm sbom terminated by signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
