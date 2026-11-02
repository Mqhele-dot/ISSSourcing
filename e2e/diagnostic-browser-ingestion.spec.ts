import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { pool } from "../server/db";

test("browser incident uploads only allowlisted evidence and persists it", async ({ page }) => {
  requireDisposableE2eDatabase();
  await gotoAuthed(page,"/admin/system-diagnostics?view=overview&privateValue=never-upload");
  await expect(page.getByRole("heading",{name:/^System diagnostics command center$/i,level:1})).toBeVisible({timeout:15_000});
  const responsePromise=page.waitForResponse(response=>response.url().endsWith("/api/diagnostics/events") && response.request().method()==="POST" && response.ok());
  await page.evaluate(()=>window.dispatchEvent(new ErrorEvent("error",{
    message:"Synthetic isolated test: private form content must remain local",
    filename:"https://example.test/private-source.js?secret=never-upload",
  })));
  const response=await responsePromise;
  expect([200,202]).toContain(response.status());
  const payload=response.request().postDataJSON();
  expect(Object.keys(payload).sort()).toEqual(["clientEventId","eventType","route"]);
  expect(payload.eventType).toBe("browser_error");
  expect(payload.route).toBe("/admin/system-diagnostics");
  const stored=await pool.query("SELECT route,event_type FROM diagnostic_client_events WHERE client_event_id=$1",[payload.clientEventId]);
  expect(stored.rows).toEqual([{route:"/admin/system-diagnostics",event_type:"browser_error"}]);
});
