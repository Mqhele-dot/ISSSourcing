/** Compatibility entry point for the guarded document hardening suite.
 * The shared disposable harness retains active/archived/include/search/version
 * assertions and tests the supported upload workflow plus legacy-path refusal.
 * It creates its own local UUID database and ephemeral server; missing services
 * fail the command rather than silently skipping or touching a business app.
 */
if (!process.argv.includes("--local-disposable")) {
  throw new Error("Use npm run test:documents-hardening; a guarded disposable database is mandatory.");
}
await import("./test-document-source-runtime");
export {};
