import type {PoolClient} from 'pg';

/** One order for short Compact scheduling/storage/publication decisions.
 * Never hold this lock while capturing, hashing, compressing or deleting files.
 */
export async function lockCompactDecisions(client:PoolClient){
  await client.query('SELECT pg_advisory_xact_lock(1948871,291800)');
}
