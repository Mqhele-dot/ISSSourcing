import net from "node:net";

/** Refuse all existing listeners, even a related app: each run owns its server. */
export async function assertUnusedLocalTestPort(env = process.env) {
  const value = String(env.PORT ?? "5000").trim();
  const port = Number(value);
  if (!/^\d{1,5}$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error("Choose a test PORT between 1 and 65535 before running the disposable gate. No database was created."), { code: "E2E_INVALID_TEST_PORT" });
  }
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", error => reject(Object.assign(new Error(
      error.code === "EADDRINUSE"
        ? `Test port ${port} is already in use. Choose another test port or stop only the verified test-owned server. No build, database creation or seeding was started.`
        : "The local test port could not be reserved. Check the test PORT and local permissions before retrying. No database was created.",
      { cause: error }), { code: error.code === "EADDRINUSE" ? "E2E_TEST_PORT_IN_USE" : "E2E_TEST_PORT_UNAVAILABLE" })));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  // This is a preflight, not an enduring reservation. The existing server-identity
  // checks must still run immediately before API mutations to cover bind races.
  return { host: "127.0.0.1", port };
}
