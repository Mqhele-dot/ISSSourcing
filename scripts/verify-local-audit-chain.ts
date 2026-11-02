import "dotenv/config";
import { pool } from "../server/db";
import { verifyAuditChainWithClient } from "../server/services/audit-chain-service";
const client=await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  const organizations=await client.query("SELECT id FROM organizations WHERE active=true ORDER BY id");
  for(const organization of organizations.rows) {
    const result=await verifyAuditChainWithClient(client,organization.id);
    if(!result.valid)throw new Error(`Audit chain verification failed for organization ${organization.id}`);
    console.log(`Audit chain verified for organization ${organization.id}`);
  }
  await client.query("COMMIT");
} finally {await client.query("ROLLBACK").catch(()=>undefined);client.release();await pool.end();}
