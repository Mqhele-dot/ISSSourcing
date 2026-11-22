import process from "node:process";

/**
 * Defer `process.exit` to the next tick to avoid Windows/libuv assertion failures
 * (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) sometimes seen when `tsx`
 * exits immediately after `fetch` / HTTP work completes.
 */
export async function exitTestAsync(code: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  process.exit(code);
}

/** Fire-and-forget async exit (call at end of test mains). */
export function exitTest(code: number): void {
  void exitTestAsync(code);
}
