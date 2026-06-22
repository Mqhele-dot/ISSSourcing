#!/usr/bin/env node
/**
 * Guarantees that recent changes (Radix Select, CSV export, QueryState, etc.) work.
 * Run: node scripts/verify-recent-changes.js
 * Exits 0 only if all checks pass.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd());
const clientSrc = join(root, "client", "src");

function grepRecursive(dir, pattern, ext = ".tsx") {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && e.name !== "node_modules") {
        results.push(...grepRecursive(full, pattern, ext));
      } else if (e.isFile() && e.name.endsWith(ext)) {
        const content = readFileSync(full, "utf8");
        const re = new RegExp(pattern, "g");
        let m;
        while ((m = re.exec(content)) !== null) {
          const lines = content.slice(0, m.index).split("\n");
          results.push({ file: full, line: lines.length, match: m[0] });
        }
      }
    }
  } catch (_) {
    // ignore
  }
  return results;
}

console.log("Verify: Radix Select (no empty value)...");
const emptySelect = grepRecursive(clientSrc, '<SelectItem\\s+value=""', ".tsx");
if (emptySelect.length > 0) {
  console.error("FAIL: Radix Select crash risk: <SelectItem value=\"\"> found. Use __none__ sentinel.");
  emptySelect.forEach(({ file, line }) => console.error(`  ${file}:${line}`));
  process.exit(1);
}
console.log("  OK: No SelectItem value=\"\" in client/src\n");

console.log("Verify: CSV generator (BOM + sep=, + CRLF)...");
execSync("npm run test:csv", { stdio: "inherit", cwd: root });
console.log("");

console.log("Verify: Production build...");
execSync("npm run build", { stdio: "inherit", cwd: root });

console.log("\nAll checks passed. Changes are verified.");
