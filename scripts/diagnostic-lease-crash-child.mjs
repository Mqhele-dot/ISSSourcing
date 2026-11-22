import pg from "pg";
import { randomUUID } from "node:crypto";
import { assertDisposableE2eEnvironment } from "./e2e-database-guard.mjs";
assertDisposableE2eEnvironment();
const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
await client.connect();
const claimed=await client.query(`UPDATE diagnostic_schedules SET lease_token=$1,
  lease_until=now()+interval '2 minutes',last_started_at=now()
  WHERE organization_id=1 AND tier='critical' AND lease_token IS NULL RETURNING lease_token`,[randomUUID()]);
if(claimed.rowCount!==1)throw new Error("Crash fixture could not claim its disposable schedule.");
console.log("Disposable schedule claimed; terminating before completion.");
// Intentionally leave the durable lease behind, as abrupt process termination does.
process.exit(0);
