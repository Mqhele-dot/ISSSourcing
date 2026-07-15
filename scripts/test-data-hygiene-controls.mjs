import assert from "node:assert/strict";
import fs from "node:fs";

const fixtureTool = fs.readFileSync("scripts/fixture-data-maintenance.ts", "utf8");
const httpHelper = fs.readFileSync("scripts/test-http.ts", "utf8");
const readyRoute = fs.readFileSync("server/routes.ts", "utf8");
const testRunner = fs.readFileSync("scripts/run-local-tests.mjs", "utf8");

assert.match(fixtureTool, /--apply/);
assert.match(fixtureTool, /--backup/);
assert.match(fixtureTool, /--confirm/);
assert.match(fixtureTool, /BEGIN/);
assert.match(fixtureTool, /ROLLBACK/);
assert.match(fixtureTool, /fixture-data-\$\{Date\.now\(\)\}/);

assert.match(httpHelper, /assertDisposableMutationTarget/);
assert.match(httpHelper, /x-test-database-mode/);
assert.match(readyRoute, /X-Test-Database-Mode/);
assert.match(testRunner, /TEST_DATABASE_URL/);
assert.match(testRunner, /assertDisposableTestDatabase/);

console.log("Data hygiene and disposable test database controls passed.");
