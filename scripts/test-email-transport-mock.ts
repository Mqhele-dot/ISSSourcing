import assert from "node:assert/strict";
import { sendEmail } from "../server/services/email-service";

const invitation = { to: "supplier@example.test", subject: "RFQ invitation", text: "Review the RFQ", html: "<p>Review the RFQ</p>" };
let delivered = 0;
const accepted = await sendEmail(invitation, {
  sendMail: async (message: unknown) => {
    delivered++;
    assert.equal((message as { to: string }).to, invitation.to);
    return { messageId: "mock-accepted" };
  },
} as any);
assert.equal(accepted.success, true);
assert.equal(delivered, 1);

const originalError = console.error;
let rejected: Awaited<ReturnType<typeof sendEmail>>;
try {
  console.error = () => undefined; // Expected provider failure is asserted below, not emitted as a test error.
  rejected = await sendEmail(invitation, {
    sendMail: async () => { throw new Error("mock provider rejection"); },
  } as any);
} finally {
  console.error = originalError;
}
assert.equal(rejected.success, false);
assert.match(rejected.error?.message ?? "", /mock provider rejection/);
assert.equal(delivered, 1, "rejected delivery must not count as accepted");
console.log("Mocked email transport passed: accepted and rejected provider results, no external delivery.");
