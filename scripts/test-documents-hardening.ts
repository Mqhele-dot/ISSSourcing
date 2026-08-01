import { setTimeout as delay } from "node:timers/promises";
import { exitTest } from "./test-exit";
import {
  apiJsonRequest,
  getTestBaseUrl,
  isConnectionRefused,
  loginForTests,
} from "./test-http";

async function waitForHealthy(baseUrl: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Documents hardening runtime (BASE_URL=%s)\n", baseUrl);

  let passed = 0;
  let failed = 0;

  const ok = (name: string) => {
    console.log("  + %s", name);
    passed++;
  };

  const bad = (name: string, detail: string) => {
    console.log("  x %s - %s", name, detail);
    failed++;
  };

  try {
    await waitForHealthy(baseUrl, 15_000);
  } catch {
    console.log("  ! Server not healthy. Start with: npm run dev");
    exitTest(0);
    return;
  }

  const cookie = await loginForTests("admin", "Admin123!", baseUrl);
  if (!cookie) {
    console.log("  ! Admin login failed. Skipping.");
    exitTest(0);
    return;
  }

  const stamp = Date.now();
  const entityType = "supplier";
  const entityId = 900000 + (stamp % 100000);
  const activeName = `runtime-doc-active-${stamp}.txt`;
  const archivedName = `runtime-doc-archive-${stamp}.txt`;

  let activeDocumentId: number | null = null;
  let archivedDocumentId: number | null = null;

  try {
    const createActive = await apiJsonRequest("/documents", {
      method: "POST",
      cookie,
      baseUrl,
      body: {
        entityType,
        entityId,
        fileUrl: `https://example.com/${activeName}`,
        fileName: activeName,
      },
    });

    if (!createActive.ok || typeof (createActive.json as { id?: unknown })?.id !== "number") {
      bad("POST /api/documents creates active row", `status ${createActive.status}`);
      throw new Error("Create active document failed");
    }
    activeDocumentId = Number((createActive.json as { id: number }).id);
    ok("POST /api/documents creates active row");

    const createArchived = await apiJsonRequest("/documents", {
      method: "POST",
      cookie,
      baseUrl,
      body: {
        entityType,
        entityId,
        fileUrl: `https://example.com/${archivedName}`,
        fileName: archivedName,
      },
    });

    if (!createArchived.ok || typeof (createArchived.json as { id?: unknown })?.id !== "number") {
      bad("POST /api/documents creates second version", `status ${createArchived.status}`);
      throw new Error("Create archived candidate failed");
    }
    archivedDocumentId = Number((createArchived.json as { id: number }).id);
    ok("POST /api/documents creates second version");

    const archiveSecond = await apiJsonRequest(`/documents/${archivedDocumentId}`, {
      method: "DELETE",
      cookie,
      baseUrl,
    });
    if (!archiveSecond.ok) {
      bad("DELETE /api/documents/:id archives row", `status ${archiveSecond.status}`);
      throw new Error("Archive second document failed");
    }
    ok("DELETE /api/documents/:id archives row");

    const activeOnly = await apiJsonRequest(
      `/documents?entityType=${entityType}&entityId=${entityId}`,
      { method: "GET", cookie, baseUrl },
    );
    const activeRows = Array.isArray(activeOnly.json) ? activeOnly.json as Array<{ id?: number }> : [];
    const activeContainsActive = activeRows.some((row) => row.id === activeDocumentId);
    const activeContainsArchived = activeRows.some((row) => row.id === archivedDocumentId);
    if (activeOnly.ok && activeContainsActive && !activeContainsArchived) {
      ok("GET /api/documents excludes archived rows by default");
    } else {
      bad("GET /api/documents excludes archived rows by default", `rows=${JSON.stringify(activeRows)}`);
    }

    const archivedOnly = await apiJsonRequest(
      `/documents?entityType=${entityType}&entityId=${entityId}&archived=only`,
      { method: "GET", cookie, baseUrl },
    );
    const archivedRows = Array.isArray(archivedOnly.json) ? archivedOnly.json as Array<{ id?: number }> : [];
    const archivedContainsActive = archivedRows.some((row) => row.id === activeDocumentId);
    const archivedContainsArchived = archivedRows.some((row) => row.id === archivedDocumentId);
    if (archivedOnly.ok && !archivedContainsActive && archivedContainsArchived) {
      ok("GET /api/documents?archived=only returns archived rows only");
    } else {
      bad("GET /api/documents?archived=only returns archived rows only", `rows=${JSON.stringify(archivedRows)}`);
    }

    const includeArchived = await apiJsonRequest(
      `/documents?entityType=${entityType}&entityId=${entityId}&archived=include&q=${encodeURIComponent("runtime-doc-")}`,
      { method: "GET", cookie, baseUrl },
    );
    const includeRows = Array.isArray(includeArchived.json) ? includeArchived.json as Array<{ id?: number }> : [];
    const includeIds = new Set(includeRows.map((row) => row.id));
    if (includeArchived.ok && includeIds.has(activeDocumentId) && includeIds.has(archivedDocumentId)) {
      ok("GET /api/documents supports include+search filters together");
    } else {
      bad("GET /api/documents supports include+search filters together", `rows=${JSON.stringify(includeRows)}`);
    }
  } catch (error) {
    if (isConnectionRefused(error)) {
      console.log("  ! Connection refused");
      exitTest(0);
      return;
    }
    console.error(error);
    failed++;
  } finally {
    const { pool } = await import("../server/db");
    if (activeDocumentId != null) {
      await pool.query("DELETE FROM documents WHERE id = $1", [activeDocumentId]).catch(() => {});
    }
    if (archivedDocumentId != null) {
      await pool.query("DELETE FROM documents WHERE id = $1", [archivedDocumentId]).catch(() => {});
    }
  }

  console.log("\nResult: %d passed, %d failed", passed, failed);
  exitTest(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  exitTest(1);
});
