import { and, eq, or } from "drizzle-orm";
import { db, pool } from "../server/db";
import { organizationMembers, users } from "../shared/schema";

const identity = process.argv[2]?.trim();
const requestedOrganizationId = process.argv[3] ? Number(process.argv[3]) : null;

if (!identity) {
  console.error("Usage: npm run access:recover-admin -- <username-or-email> [organization-id]");
  process.exitCode = 1;
} else {
  try {
    const matches = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        preferences: users.preferences,
        defaultOrganizationId: users.defaultOrganizationId,
      })
      .from(users)
      .where(or(eq(users.username, identity), eq(users.email, identity)));

    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? "No matching account was found." : "Identity matched more than one account.");
    }

    const account = matches[0];
    const memberships = await db
      .select({ id: organizationMembers.id, organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, account.id));

    const organizationId = requestedOrganizationId
      ?? (account.defaultOrganizationId && memberships.some((membership) => membership.organizationId === account.defaultOrganizationId)
        ? account.defaultOrganizationId
        : memberships.length === 1
          ? memberships[0].organizationId
          : null);

    if (!organizationId || !memberships.some((membership) => membership.organizationId === organizationId)) {
      throw new Error("The account has multiple memberships. Supply the organization ID to recover exactly one membership.");
    }

    const preferences = account.preferences && typeof account.preferences === "object" && !Array.isArray(account.preferences)
      ? { ...(account.preferences as Record<string, unknown>) }
      : {};
    delete preferences.customRoleId;
    delete preferences.allowedNavPaths;

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          role: "admin",
          active: true,
          accountLocked: false,
          lockoutUntil: null,
          failedLoginAttempts: 0,
          preferences,
          updatedAt: new Date(),
        })
        .where(eq(users.id, account.id));

      await tx
        .update(organizationMembers)
        .set({ applicationRole: "admin", active: true, status: "active" })
        .where(and(
          eq(organizationMembers.userId, account.id),
          eq(organizationMembers.organizationId, organizationId),
        ));
    });

    console.log(`Administrator access restored for ${account.email} in organization ${organizationId}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
