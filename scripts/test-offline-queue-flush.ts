import assert from "node:assert/strict";
import {
  clearOfflineQueue,
  enqueueOfflineAction,
  flushOfflineQueueToServer,
  peekOfflineQueue,
} from "../client/src/lib/offline-queue";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function main() {
  await clearOfflineQueue();

  const applied = await enqueueOfflineAction("mobile_count_line", { sessionId: 101, countedQty: 2 });
  const duplicate = await enqueueOfflineAction("mobile_count_submit", { sessionId: 101 });
  const failed = await enqueueOfflineAction("mobile_count_submit", { sessionId: 202 });
  const scan = await enqueueOfflineAction("scan", { value: "BC-100", intent: "scan", format: "QR_CODE" });
  let syncBatchCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/csrf-token")) {
      return jsonResponse({ csrfToken: "offline-queue-test-token" });
    }
    if (url.endsWith("/api/sync/batch")) {
      syncBatchCalls += 1;
      if (syncBatchCalls === 1) {
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
          actions?: Array<{ idempotencyKey: string; type: string; payload: Record<string, unknown> }>;
        };
        const scanAction = requestBody.actions?.find((action) => action.idempotencyKey === scan.id);
        assert.ok(scanAction, "queued scan should be posted to /api/sync/batch");
        assert.equal(scanAction?.type, "scan");
        assert.equal(scanAction?.payload.value, "BC-100");
        assert.equal(scanAction?.payload.intent, "scan");
      }
      return jsonResponse({
        ok: true,
        data: {
          failed: [{ idempotencyKey: failed.id, message: "Replay failed." }],
          results: [
            { idempotencyKey: applied.id, status: "applied", type: applied.type, message: "Applied." },
            { idempotencyKey: duplicate.id, status: "duplicate", type: duplicate.type, message: "Already applied." },
            { idempotencyKey: failed.id, status: "failed", type: failed.type, message: "Replay failed." },
            { idempotencyKey: scan.id, status: "applied", type: scan.type, message: "Scan replayed." },
          ],
        },
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const partial = await flushOfflineQueueToServer();
  assert.equal(partial.ok, false, "partial replay should keep failed actions queued");
  assert.equal(partial.status, 200);

  const remainingAfterPartial = await peekOfflineQueue();
  assert.equal(remainingAfterPartial.length, 1, "only failed action should remain queued");
  assert.equal(remainingAfterPartial[0]?.id, failed.id);
  assert.equal(remainingAfterPartial[0]?.retryCount, 1);
  assert.match(String(remainingAfterPartial[0]?.failedAt), /^\d{4}-\d{2}-\d{2}T/);

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/csrf-token")) {
      return jsonResponse({ csrfToken: "offline-queue-test-token" });
    }
    if (url.endsWith("/api/sync/batch")) {
      return jsonResponse({
        ok: true,
        data: {
          failed: [],
          results: [{ idempotencyKey: failed.id, status: "applied", type: failed.type, message: "Applied." }],
        },
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const final = await flushOfflineQueueToServer();
  assert.equal(final.ok, true, "successful replay should clear the queue");
  assert.equal(final.status, 200);
  assert.equal((await peekOfflineQueue()).length, 0);

  console.log("test-offline-queue-flush: passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    globalThis.fetch = originalFetch;
    await clearOfflineQueue();
  });
