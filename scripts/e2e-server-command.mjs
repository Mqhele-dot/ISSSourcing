import path from "node:path";
import { spawn } from "node:child_process";

/** Never interpret an environment-provided command through a shell or silently
 * fall back from packaged code to the source development server. */
export function resolveE2eServerCommand(command, root) {
  const selected = String(command || "npm run dev").trim();
  if (selected === "node dist/index.js") return { mode: "built", entryPoint: "dist/index.js", args: [path.resolve(root, "dist/index.js")] };
  if (selected === "npm run dev") return { mode: "source", entryPoint: "server/index.ts", args: ["--import", "tsx", path.resolve(root, "server/index.ts")] };
  throw Object.assign(new Error("Unsupported test-server command. Choose 'npm run dev' or 'node dist/index.js'; no fallback server was started."), { code: "E2E_UNSUPPORTED_SERVER_COMMAND" });
}

export function spawnE2eServer(command, { cwd, env }) {
  const definition = resolveE2eServerCommand(command, cwd);
  const child = spawn(process.execPath, definition.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  return { child, definition };
}
