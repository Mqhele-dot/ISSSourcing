import { config } from "dotenv";
import pg from "pg";

config({ path: ".env", override: false });

const { Client } = pg;

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL;
  const host = process.env.PGHOST;
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error("Set DATABASE_URL or PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD");
  }
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

const enumDefinitions = {
  user_role: [
    "admin",
    "manager",
    "planner",
    "warehouse_staff",
    "sales",
    "auditor",
    "supplier",
    "custom",
    "viewer",
  ],
  permission_type: [
    "create",
    "read",
    "update",
    "delete",
    "approve",
    "export",
    "import",
    "assign",
    "manage",
    "execute",
    "transfer",
    "print",
    "scan",
    "view_reports",
    "admin",
    "configure",
    "restrict",
    "download",
    "upload",
    "audit",
    "verify",
  ],
  resource: [
    "inventory",
    "purchases",
    "suppliers",
    "categories",
    "warehouses",
    "reports",
    "users",
    "settings",
    "reorder_requests",
    "stock_movements",
    "analytics",
    "dashboards",
    "notifications",
    "audit_logs",
    "user_profiles",
    "documents",
    "custom_roles",
    "activity_logs",
    "import_export",
    "system",
  ],
};

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
    `,
    [tableName],
  );
  return result.rows[0]?.exists === true;
}

async function columnType(client, tableName, columnName) {
  const result = await client.query(
    `
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    `,
    [tableName, columnName],
  );
  return result.rows[0]?.udt_name ?? null;
}

async function ensureEnum(client, enumName, values) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = ${quoteLiteral(enumName)}) THEN
        CREATE TYPE ${enumName} AS ENUM (${values.map(quoteLiteral).join(", ")});
      END IF;
    END $$;
  `);

  for (const value of values) {
    await client.query(`ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS ${quoteLiteral(value)}`);
  }
}

async function normalizeEnumColumn(client, tableName, columnName, enumName, fallbackValue) {
  if (!(await tableExists(client, tableName))) return false;
  const currentType = await columnType(client, tableName, columnName);
  if (!currentType || currentType === enumName) return false;

  const values = enumDefinitions[enumName];
  if (!values) throw new Error(`Unknown enum definition: ${enumName}`);
  const allowedSql = values.map(quoteLiteral).join(", ");

  await client.query(`
    UPDATE ${tableName}
    SET ${columnName} = ${quoteLiteral(fallbackValue)}
    WHERE ${columnName} IS NULL
       OR lower(trim(${columnName}::text)) NOT IN (${allowedSql})
  `);

  await client.query(`
    ALTER TABLE ${tableName}
    ALTER COLUMN ${columnName}
    TYPE ${enumName}
    USING lower(trim(${columnName}::text))::${enumName}
  `);

  return true;
}

const client = new Client({ connectionString: resolveDatabaseUrl() });

try {
  await client.connect();
  for (const [enumName, values] of Object.entries(enumDefinitions)) {
    await ensureEnum(client, enumName, values);
  }

  const changed = [];
  if (await normalizeEnumColumn(client, "users", "role", "user_role", "viewer")) {
    changed.push("users.role");
  }
  if (await normalizeEnumColumn(client, "permissions", "role", "user_role", "viewer")) {
    changed.push("permissions.role");
  }
  if (await normalizeEnumColumn(client, "permissions", "resource", "resource", "system")) {
    changed.push("permissions.resource");
  }
  if (await normalizeEnumColumn(client, "permissions", "permission_type", "permission_type", "read")) {
    changed.push("permissions.permission_type");
  }
  if (await normalizeEnumColumn(client, "custom_role_permissions", "resource", "resource", "system")) {
    changed.push("custom_role_permissions.resource");
  }
  if (await normalizeEnumColumn(client, "custom_role_permissions", "permission_type", "permission_type", "read")) {
    changed.push("custom_role_permissions.permission_type");
  }

  if (changed.length > 0) {
    console.log(`DB migration preflight normalized enum columns: ${changed.join(", ")}`);
  } else {
    console.log("DB migration preflight passed; no legacy enum columns required normalization.");
  }
} finally {
  await client.end().catch(() => undefined);
}
