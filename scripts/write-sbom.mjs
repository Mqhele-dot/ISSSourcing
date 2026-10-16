#!/usr/bin/env node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const localCache = path.join(repoRoot, ".npm-cache-audit");
const outputPath = path.join(repoRoot, "sbom.cdx.json");
const manifestWorkspace = mkdtempSync(path.join(os.tmpdir(), "iss-sbom-"));

mkdirSync(localCache, { recursive: true });
copyFileSync(path.join(repoRoot, "package.json"), path.join(manifestWorkspace, "package.json"));
copyFileSync(path.join(repoRoot, "package-lock.json"), path.join(manifestWorkspace, "package-lock.json"));

const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArgs = ["--cache", localCache, "sbom", "--sbom-format", "cyclonedx", "--package-lock-only"];
const commandArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd", ...npmArgs] : npmArgs;
const result = spawnSync(command, commandArgs, {
  // Generate from the committed manifest graph. This prevents a stale, partially
  // hydrated, or platform-specific node_modules tree from corrupting the SBOM.
  cwd: manifestWorkspace,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 25,
  env: {
    ...process.env,
    npm_config_cache: process.env.npm_config_cache || localCache,
  },
});
rmSync(manifestWorkspace, { recursive: true, force: true });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status === 0 && result.stdout) {
  writeFileSync(outputPath, result.stdout);
}

if (result.status === 0 && result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.signal) {
  console.error(`npm sbom terminated by signal ${result.signal}.`);
  process.exit(1);
}

if (result.status === 0) process.exit(0);

// npm 11 can report ESBOMPROBLEMS for valid deduped dependencies when package
// overrides are present. Preserve the supply-chain artifact by deriving a
// CycloneDX inventory from the authoritative lockfile instead of node_modules.
const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
const root = lock.packages?.[""] ?? {};
const components = Object.entries(lock.packages ?? {})
  .filter(([location, entry]) => location && entry?.version)
  .map(([location, entry]) => {
    const name = location.split("node_modules/").pop();
    const component = {
      type: "library",
      name,
      version: entry.version,
      "bom-ref": `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(entry.version)}?path=${encodeURIComponent(location)}`,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(entry.version)}`,
      properties: [{ name: "npm:package-path", value: location }],
    };
    if (typeof entry.integrity === "string" && entry.integrity.startsWith("sha512-")) {
      component.hashes = [{ alg: "SHA-512", content: Buffer.from(entry.integrity.slice(7), "base64").toString("hex") }];
    }
    if (typeof entry.license === "string") component.licenses = [{ license: { id: entry.license } }];
    return component;
  });
const rootRef = `pkg:npm/${encodeURIComponent(root.name ?? lock.name)}@${encodeURIComponent(root.version ?? lock.version)}`;
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: "application", name: "isssourcing-lockfile-sbom", version: "1" }] },
    component: { type: "application", name: root.name ?? lock.name, version: root.version ?? lock.version, "bom-ref": rootRef, purl: rootRef },
  },
  components,
  dependencies: [{ ref: rootRef, dependsOn: components.map((component) => component["bom-ref"]) }],
};
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.warn("npm sbom could not validate the overridden dependency tree; generated CycloneDX from package-lock.json.");
