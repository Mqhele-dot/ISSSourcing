import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import {
  createServer as createViteServer,
  createLogger,
  type ServerOptions as ViteServerOptions,
} from "vite";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function codespacePublicWebOrigin(): string | null {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  const port = process.env.PORT ?? "5000";
  if (!name || !domain) return null;
  return `https://${name}-${port}.${domain}`;
}

/**
 * HMR over forwarded HTTPS in GitHub Codespaces often falls back to full page reloads (WS flake / client
 * reconnect). That remounts the SPA and refetches `/api/user`, `/api/ready`, etc. every few seconds.
 * Opt in with `VITE_ENABLE_HMR=1` when you need hot reload there.
 */
function viteHmrDisabled(codespacesPublicOrigin: string | null): boolean {
  if (process.env.VITE_DISABLE_HMR === "1") return true;
  return codespacesPublicOrigin != null && process.env.VITE_ENABLE_HMR !== "1";
}

export async function setupVite(app: Express, server: Server) {
  const publicOrigin = codespacePublicWebOrigin();
  const hmrHost =
    publicOrigin != null
      ? (() => {
          try {
            return new URL(publicOrigin).hostname;
          } catch {
            return null;
          }
        })()
      : null;

  const hmrOff = viteHmrDisabled(publicOrigin);

  const serverOptions: ViteServerOptions = {
    middlewareMode: true,
    hmr: hmrOff
      ? false
      : hmrHost != null
        ? {
            server,
            host: hmrHost,
            protocol: "wss",
            clientPort: 443,
          }
        : { server },
    allowedHosts: true as const,
    ...(publicOrigin != null ? { origin: publicOrigin } : {}),
  };

  if (publicOrigin != null) {
    log(
      `Vite Codespaces origin: ${publicOrigin}${
        hmrOff
          ? " (HMR off by default — set VITE_ENABLE_HMR=1 to enable hot reload)"
          : ` (HMR wss @ ${hmrHost})`
      }`,
      "vite",
    );
  }

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      /**
       * Do not exit the Node process on Vite log errors. The previous `process.exit(1)` tore down the
       * whole Express dev server on transient PostCSS/Tailwind issues and dropped HMR — the browser then
       * reconnects in a loop (looks like endless full reloads), especially in remote/Codespaces setups.
       */
      error: (msg, options) => {
        viteLogger.error(msg, options);
      },
    },
    /** Preserve `server.watch` (and other dev-server tweaks) from vite.config — do not replace the whole block. */
    server: {
      ...(viteConfig.server ?? {}),
      ...serverOptions,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
