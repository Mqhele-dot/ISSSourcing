#!/usr/bin/env node
/**
 * NPM lifecycle footprint audit:
 * - Default: scan package-lock.json for `hasInstallScript` (no node_modules needed; no hooks run).
 * - `--scan-node-modules`: read nested package.json for preinstall/install/postinstall/prepare.
 *
 * - Default/report: exit 0; warns on packages outside ALLOW_INSTALL_HOOKS.
 * - `--enforce`: exit 1 if lockfile `hasInstallScript` packages stray outside ALLOW_INSTALL_HOOKS.
 *               With `--scan-node-modules`, also fails if NM hooks reference a package whose `name`
 *               is not in ALLOW ∪ ids seen from lockfile.
 *
 * CI: run with `--enforce` (blocking in supply-chain workflow for lockfile-derived hooks).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const HOOK_FIELDS = ["preinstall", "install", "postinstall", "prepare"];
const ALLOW_INSTALL_HOOKS = new Set([
  // Native / binary downloads (expected)
  "canvas",
  "electron",
  "electron-winstaller",
  // esbuild wrappers download platform binaries
  "esbuild",
  // macOS watchers (skipped on Linux)
  "fsevents",
  // Polyfill / telemetry — review periodically
  "core-js",
  "@scarf/scarf",
  // Imaging / DB / OCR native stacks
  "sharp",
  "sqlite3",
  "tesseract.js",
]);

function canonicalIdFromLockKey(lockKey) {
  const trimmed = lockKey.startsWith("node_modules/")
    ? lockKey.slice("node_modules/".length)
    : lockKey.replace(/^.*?node_modules\//, "");
  const parts = trimmed.split(/\/node_modules\//);
  return parts[parts.length - 1] || trimmed;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function installScriptPackagesFromLockfile(repoRoot) {
  const lockPath = path.join(repoRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("package-lock.json not found");

  const lock = readJson(lockPath);
  const packages = lock.packages;
  if (!packages || typeof packages !== "object") throw new Error("package-lock packages missing");

  /** @type {Map<string, string>} */
  const map = new Map();
  for (const [lockKey, meta] of Object.entries(packages)) {
    if (!lockKey.includes("node_modules")) continue;
    if (!meta || typeof meta !== "object" || meta.hasInstallScript !== true) continue;
    const id = canonicalIdFromLockKey(lockKey);
    if (!map.has(id)) map.set(id, lockKey);
  }

  return [...map.entries()].map(([id, lockKey]) => ({ id, lockKey }));
}

/** @typedef {{ npmName: string, hooks: string[] }} HookRow */

/** Recursively walk node_modules and collect lifecycle hooks using each package.json "name". */
/** @returns {HookRow[]} */
function scanNodeModulesHooks(repoRoot) {
  /** @type {HookRow[]} */
  const rows = [];

  function readHooks(absPkgDir) {
    const pkgPath = path.join(absPkgDir, "package.json");
    if (!fs.existsSync(pkgPath)) return;
    const pkg = readJson(pkgPath);
    const npmName = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : null;
    if (!npmName) return;
    /** @type {string[]} */
    const found = [];
    for (const f of HOOK_FIELDS) {
      const v = pkg.scripts?.[f];
      if (typeof v === "string" && v.trim()) {
        found.push(`${f}:${v.slice(0, 140)}${v.length > 140 ? "…" : ""}`);
      }
    }
    if (found.length) rows.push({ npmName, hooks: found });
  }

  function walk(nmAbs) {
    if (!fs.existsSync(nmAbs)) return;
    for (const ent of fs.readdirSync(nmAbs, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const absChild = path.join(nmAbs, ent.name);
      if (!ent.isDirectory()) continue;

      if (ent.name.startsWith("@")) {
        const scopeDir = absChild;
        for (const sc of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (!sc.isDirectory()) continue;
          const absPkg = path.join(scopeDir, sc.name);
          readHooks(absPkg);
          const nested = path.join(absPkg, "node_modules");
          if (fs.existsSync(nested)) walk(nested);
        }
        continue;
      }

      readHooks(absChild);
      const nested = path.join(absChild, "node_modules");
      if (fs.existsSync(nested)) walk(nested);
    }
  }

  walk(path.join(repoRoot, "node_modules"));

  rows.sort((a, b) => a.npmName.localeCompare(b.npmName));
  /** Dedupe npmName (prefer first occurrence) */
  /** @type {Map<string, string[]>} */
  const uniq = new Map();
  for (const { npmName, hooks } of rows) {
    if (!uniq.has(npmName)) uniq.set(npmName, [...hooks]);
  }
  return [...uniq.entries()].map(([npmName, hooks]) => ({ npmName, hooks }));
}

await (async () => {
  const args = new Set(process.argv.slice(2));
  const scanNM = args.has("--scan-node-modules") || args.has("--node-modules");
  const enforce = args.has("--enforce");
  const repoRoot = process.cwd();

  console.log("[lifecycle-audit] repository:", repoRoot);
  console.log("[lifecycle-audit] mode:", scanNM ? "lockfile + node_modules" : "lockfile (hasInstallScript only)");
  console.log("[lifecycle-audit] enforce:", enforce);

  const locklist = installScriptPackagesFromLockfile(repoRoot);
  console.log("[lifecycle-audit] packages with lockfile hasInstallScript:", locklist.length);
  for (const { id, lockKey } of locklist.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  - ${id} (${lockKey})`);
  }

  /** @type {Set<string>} */
  const mergedAllow = new Set(ALLOW_INSTALL_HOOKS);
  for (const { id } of locklist) mergedAllow.add(id);

  const unknownLock = locklist.filter(({ id }) => !ALLOW_INSTALL_HOOKS.has(id));
  if (!enforce && unknownLock.length) {
    console.warn("[lifecycle-audit] WARN (report-only): lockfile installers outside ALLOW_INSTALL_HOOKS — review:");
    for (const row of unknownLock) console.warn("  •", row.id);
  } else if (enforce && unknownLock.length) {
    console.error("[lifecycle-audit] ERROR: lockfile install scripts outside ALLOW_INSTALL_HOOKS:");
    for (const row of unknownLock) console.error("  •", row.id, row.lockKey);
  }

  let nmFails = [];
  if (scanNM) {
    if (!fs.existsSync(path.join(repoRoot, "node_modules"))) {
      console.warn("[lifecycle-audit] WARN: node_modules missing; skip deep scan.");
    } else {
      console.log("\n[node_modules] packages with lifecycle script fields:");
      const nmRows = scanNodeModulesHooks(repoRoot);
      for (const { npmName, hooks } of nmRows) {
        console.log(`  ${npmName}`);
        hooks.forEach((h) => console.log(`      ${h}`));
      }
      nmFails = nmRows.map((r) => r.npmName).filter((nm) => !mergedAllow.has(nm));
      if (!enforce && nmFails.length) {
        console.warn("[lifecycle-audit] WARN: node_modules lifecycle packages not in ALLOW ∪ lockfile ids:");
        nmFails.forEach((nm) => console.warn(`  • ${nm}`));
      }
      if (enforce && nmFails.length) {
        console.error("[lifecycle-audit] ERROR: node_modules lifecycle hooks from unexpected npm names:");
        nmFails.forEach((nm) => console.error(`  • ${nm}`));
      }
    }
  }

  if (enforce && (unknownLock.length || nmFails.length)) process.exit(1);
})();
