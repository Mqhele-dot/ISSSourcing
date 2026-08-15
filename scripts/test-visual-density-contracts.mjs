import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const table = read("client/src/components/ui/table.tsx");
const card = read("client/src/components/ui/card.tsx");
const employees = read("client/src/pages/employee-profiles.tsx");
const roles = read("client/src/components/user/role-manager.tsx");
const diagnostics = read("client/src/pages/system-diagnostics-page.tsx");
const subscription = read("client/src/pages/subscription.tsx");
const auditLogs = read("client/src/pages/audit-logs.tsx");
const mobileLayout = read("client/src/components/layout/mobile-layout.tsx");

assert.match(table, /max-h-\[min\(65dvh,42rem\)\]/, "tables must remain viewport-bounded");
assert.match(table, /overflow-auto/, "tables must retain two-axis overflow access");
assert.match(card, /min-w-0 overflow-hidden/, "cards must not exceed their grid track");
assert.match(employees, /grid items-start gap-6/, "profile columns must not stretch short cards to page height");
assert.match(employees, /pageSize=10/, "employee audit evidence must be page bounded");
assert.match(employees, /max-h-\[28rem\]/, "employee audit evidence must stay inside a bounded region");
assert.match(employees, /Review permission details/, "permission dumps must use progressive disclosure");
assert.match(employees, /grid grid-cols-2 gap-2/, "profile metrics must not squeeze three tiles into a narrow card");
assert.match(employees, /min-h-14 min-w-0/, "profile navigation choices must align and contain long labels");
assert.equal((roles.match(/defaultOpen=\{false\}/g) ?? []).length, 2, "both role permission matrices must start collapsed");
assert.match(diagnostics, /diagnostics-advanced-evidence/, "secondary diagnostics must be collapsed behind advanced evidence");
assert.match(subscription, /sm:grid-cols-2 2xl:grid-cols-3/, "subscription usage limits must use width-safe breakpoints");
assert.match(subscription, /flex flex-wrap items-center justify-between gap-2/, "subscription labels and limit badges must wrap safely");
assert.match(auditLogs, /customEntityTypeMode \? \(/, "the redundant custom entity input must only render in custom mode");
assert.match(auditLogs, /sm:col-span-2/, "audit filter actions need enough width to keep their labels intact");
assert.match(mobileLayout, /max-w-\[30rem\]/, "desktop mobile routes must retain a phone-sized presentation");
assert.match(mobileLayout, /safe-area-inset-bottom/, "the phone shell must reserve bottom safe-area space");

console.log("Visual density and overflow contracts passed.");
