import assert from "node:assert/strict";
import { pool } from "../../server/db";

export type ScopedPermission = {
  resource: string;
  permissionType?: string;
  actions?: string[];
};

export type SeededEvidenceUser = {
  userId: number;
  username: string;
  password: string;
  customRoleId?: number;
};

const TEST_PASSWORD = "Admin123!";

export async function getSeededAdmin(): Promise<{ id: number; password: string }> {
  const result = await pool.query<{ id: number; password: string }>(
    `SELECT id, password FROM users WHERE username = 'admin' LIMIT 1`,
  );
  assert.ok(result.rows[0], "The disposable database must contain the seeded admin user.");
  return result.rows[0];
}

export async function seedCustomPermissionUser(input: {
  suffix?: string;
  label?: string;
  username?: string;
  permissions: ScopedPermission[];
  organizationId?: number;
}): Promise<SeededEvidenceUser> {
  const organizationId = input.organizationId ?? 1;
  const admin = await getSeededAdmin();
  const suffix = input.suffix ?? `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const label = input.label ?? input.username ?? "Custom Permission User";
  const roleName = `W7B ${label} ${suffix}`;
  const role = await pool.query<{ id: number }>(
    `INSERT INTO custom_roles (
       organization_id, name, description, created_by, is_active, is_system_role, created_at, updated_at
     ) VALUES ($1, $2, 'Wave 7B disposable permission evidence', $3, TRUE, FALSE, NOW(), NOW())
     RETURNING id`,
    [organizationId, roleName, admin.id],
  );
  const customRoleId = role.rows[0].id;
  const resourceAliases: Record<string, string> = {
    approvals: "settings",
  };
  const normalizedPermissions = input.permissions.flatMap((permission) => {
    const resource = resourceAliases[permission.resource] ?? permission.resource;
    if (permission.permissionType) {
      return [{ resource, permissionType: permission.permissionType }];
    }
    return (permission.actions ?? []).map((permissionType) => ({ resource, permissionType }));
  });
  for (const permission of normalizedPermissions) {
    await pool.query(
      `INSERT INTO custom_role_permissions (role_id, resource, permission_type, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [customRoleId, permission.resource, permission.permissionType],
    );
  }

  const username = input.username
    ? input.username
    : `w7b-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`.slice(0, 60);
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (
       username, password, email, full_name, role, active, email_verified,
       preferences, default_organization_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'custom', TRUE, TRUE, $5::jsonb, $6, NOW(), NOW())
     RETURNING id`,
    [
      username,
      admin.password,
      `${username}@example.test`,
      `Wave 7B ${label}`,
      JSON.stringify({ customRoleId }),
      organizationId,
    ],
  );
  await pool.query(
    `INSERT INTO organization_members (
       organization_id, user_id, role, application_role, active, status, created_at
     ) VALUES ($1, $2, 'member', 'custom', TRUE, 'active', NOW())`,
    [organizationId, user.rows[0].id],
  );
  return { userId: user.rows[0].id, username, password: TEST_PASSWORD, customRoleId };
}

export async function seedSystemRoleUser(input: {
  suffix: string;
  label: string;
  role: string;
  organizationId?: number;
}): Promise<SeededEvidenceUser> {
  const organizationId = input.organizationId ?? 1;
  const admin = await getSeededAdmin();
  const normalized = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const username = `w7b-${normalized}-${input.suffix}`.slice(0, 60);
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (
       username, password, email, full_name, role, active, email_verified,
       default_organization_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, $6, NOW(), NOW())
     RETURNING id`,
    [
      username,
      admin.password,
      `${username}@example.test`,
      `Wave 7B ${input.label}`,
      input.role,
      organizationId,
    ],
  );
  await pool.query(
    `INSERT INTO organization_members (
       organization_id, user_id, role, application_role, active, status, created_at
     ) VALUES ($1, $2, 'member', $3, TRUE, 'active', NOW())`,
    [organizationId, user.rows[0].id, input.role],
  );
  return { userId: user.rows[0].id, username, password: TEST_PASSWORD };
}

export async function removeEvidenceUsers(users: SeededEvidenceUser[]): Promise<void> {
  const userIds = users.map((user) => user.userId);
  const roleIds = users.map((user) => user.customRoleId).filter((id): id is number => id != null);
  if (userIds.length > 0) {
    await pool.query(`DELETE FROM organization_members WHERE user_id = ANY($1::int[])`, [userIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
  }
  if (roleIds.length > 0) {
    await pool.query(`DELETE FROM custom_role_permissions WHERE role_id = ANY($1::int[])`, [roleIds]);
    await pool.query(`DELETE FROM custom_roles WHERE id = ANY($1::int[])`, [roleIds]);
  }
}
