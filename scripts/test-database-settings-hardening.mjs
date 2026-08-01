import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} is missing required source evidence: ${needle}`);
}

function assertExcludes(text, needle, label) {
  assert(!text.includes(needle), `${label} still contains forbidden source evidence: ${needle}`);
}

const form = read("client/src/components/settings/database-settings-form.tsx");
const bridge = read("client/src/lib/electron-bridge.ts");
const preload = read("electron/preload.js");

assertIncludes(form, "database-settings-web-only", "database settings form");
assertIncludes(form, "database-settings-desktop", "database settings form");
assertIncludes(form, "Fail-closed configuration boundary", "database settings form");
assertIncludes(form, "Create backup", "database settings form");
assertIncludes(form, "Run sync", "database settings form");
assertExcludes(form, "update-database-settings", "database settings form");
assertExcludes(form, 'name="password"', "database settings form");
assertExcludes(form, "Database Host", "database settings form");

assertIncludes(bridge, "get-database-info", "electron bridge");
assertIncludes(bridge, "sync-database", "electron bridge");
assertIncludes(bridge, "check-network-status", "electron bridge");

assertIncludes(preload, "'get-database-info'", "electron preload");
assertIncludes(preload, "'sync-database'", "electron preload");
assertIncludes(preload, "'check-network-status'", "electron preload");

console.log("Database settings hardening checks passed.");
