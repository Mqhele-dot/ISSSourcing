import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "client/src"], { encoding: "utf8" })
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => /\.tsx?$/u.test(file))
  .filter((file) => !/(__tests__|\.test\.|\.spec\.|fixtures|dev-test|real-time-updates-page|sync-test-page|sync-dashboard)/u.test(file));

const rules = [
  { code: "FABRICATED_TENANT_ID", pattern: /organizationId\s*:\s*1\b/u },
  { code: "FAKE_SETTINGS_FALLBACK", pattern: /settings\s*\|\|\s*defaultSettings|settings\s*\?\?\s*defaultSettings/u },
  { code: "INVENTED_MAIN_WAREHOUSE", pattern: /(?:add|push)\(\s*["']Main Warehouse["']\s*\)/u },
  { code: "CLIENT_PERMISSION_FALLBACK", pattern: /FALLBACK_PERMISSION_(?:CATALOG|TYPES|CATEGORIES)/u },
  { code: "FAKE_PROVIDER_SUCCESS", pattern: /provider\s*:\s*["']demo["'][\s\S]{0,100}status\s*:\s*["']operational["']/u },
];

const failures = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const rule of rules) if (rule.pattern.test(source)) failures.push(`${rule.code}: ${file}`);
}

if (failures.length) {
  console.error("Production static UI authority check failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`Production static UI authority check passed (${files.length} files).`);
