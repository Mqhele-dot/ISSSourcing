import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { assertDisposableE2eEnvironment, assertDisposableE2eServer } from "./e2e-database-guard.mjs";

const testUrl = "postgresql://postgres:secret@127.0.0.1:5432/isssourcing_test_gate";
const expected = assertDisposableE2eEnvironment({ DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl });
assert.throws(() => assertDisposableE2eEnvironment({ DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl.replace("_test_gate", "_prod") }), /non-disposable|same disposable/);
assert.throws(() => assertDisposableE2eEnvironment({ DATABASE_URL: testUrl.replace("_test_gate", "_test_other"), TEST_DATABASE_URL: testUrl }), /same disposable/);
assert.throws(() => assertDisposableE2eEnvironment({ DATABASE_URL: testUrl, TEST_DATABASE_URL: undefined }), /requires DATABASE_URL/);

let identity = expected;
const server = createServer((_request, response) => {
  response.writeHead(200, { "X-Test-Database-Mode": "disposable", "X-Test-Database-Identity": identity });
  response.end("ok");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const url = `http://127.0.0.1:${server.address().port}/api/ready`;
  await assertDisposableE2eServer(url, expected);
  identity = "another-test-database";
  await assert.rejects(assertDisposableE2eServer(url, expected), /refused/);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log("E2E database guard passed: unsafe names, mismatched URLs, and unrelated servers are refused.");
