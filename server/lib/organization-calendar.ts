import type { PoolClient } from "pg";

export class OrganizationCalendarError extends Error {
  constructor(readonly reason: "missing_organization" | "invalid_timezone") {
    super(reason === "invalid_timezone" ? "Ask an administrator to configure a valid organization timezone." : "Your organization is not available.");
  }
}

/** PostgreSQL's transaction clock gives all reads in one observation the same local day. */
export async function readOrganizationCalendar(client: PoolClient, organizationId: number) {
  const {rows:[row]} = await client.query<{timezone:string}>(`SELECT COALESCE(NULLIF(btrim(timezone),''),'Africa/Johannesburg') AS timezone
    FROM organizations WHERE id=$1`,[organizationId]);
  if (!row) throw new OrganizationCalendarError("missing_organization");
  // Validate a named zone before the calculation. Enumerating pg_timezone_names
  // reads hundreds of definitions per call and can dominate a cold Windows request.
  try {
    if (!/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(row.timezone)) throw new RangeError();
    new Intl.DateTimeFormat("en",{timeZone:row.timezone});
  } catch {
    throw new OrganizationCalendarError("invalid_timezone");
  }
  try {
    const {rows:[{today}]}=await client.query<{today:string}>(
      "SELECT to_char(transaction_timestamp() AT TIME ZONE $1,'YYYY-MM-DD') AS today",[row.timezone]);
    return {timezone:row.timezone,today};
  } catch(error) {
    // ICU and PostgreSQL may carry different timezone database versions.
    if((error as {code?:string})?.code==="22023") throw new OrganizationCalendarError("invalid_timezone");
    throw error;
  }
}
