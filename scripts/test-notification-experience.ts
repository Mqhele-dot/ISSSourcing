import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { userFacingError } from "../client/src/lib/user-facing-error";

assert.equal(userFacingError({ status: 401, message: "[UNAUTHORIZED] Unauthorized" }), "Your session has ended. Sign in again to continue.");
assert.match(userFacingError({ status: 403, message: "Forbidden: missing permission" }), /Ask an administrator/);
assert.match(userFacingError({ status: 409, message: "This record changed" }), /record changed/);
assert.doesNotMatch(userFacingError({ status: 500, message: "SQLSTATE 23505 INSERT INTO notifications" }), /SQLSTATE|INSERT INTO/);
assert.equal(userFacingError({ status: 400, code: "INVALID_QUANTITY", message: "Enter a quantity greater than zero." }), "Enter a quantity greater than zero.");

const routes = readFileSync("server/modules/notifications/register-notification-routes.ts", "utf8");
const emitter = readFileSync("server/services/notification-emitter.ts", "utf8");
const header = readFileSync("client/src/components/layout/header.tsx", "utf8");
assert.match(routes, /count\(\*\) FILTER \(WHERE read_at IS NULL\)/);
assert.match(routes, /archived_at IS NULL/);
assert.match(routes, /\/api\/notifications\/:id\/archive/);
assert.match(routes, /\/api\/notifications\/archive-read/);
assert.match(emitter, /organizationMembers\.organizationId/);
assert.match(emitter, /organizationMembers\.active/);
assert.match(header, /Clear read/);
assert.match(header, /refetchOnWindowFocus: true/);
assert.match(header, /seenNotificationIds/);
assert.match(header, /fresh\.title/);
console.log("Notification inbox and plain-language error contracts passed.");
