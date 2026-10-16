import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { log } from "../vite";
import { appEnv } from "../config/env";
import { getBuildInfo } from "../lib/build-info";
import { logger } from "../lib/logger";

export type StartupListenOptions = {
  host: string;
  port: number;
  localUrl: string;
  forwardedUrl: string | null;
};

export function attachStartupBannerListener(server: Server, opts: StartupListenOptions): void {
  const { host, port, localUrl, forwardedUrl } = opts;
  server.listen(port, host, () => {
    const isDev = appEnv.isDevelopment;
    const bannerLine = "=".repeat(76);
    console.log(`\n${bannerLine}`);
    console.log("  ISSSourcing — web app (API + static/Vite)");
    console.log(`  Browser URL:  ${localUrl}`);
    console.log(`  Port:         ${port}   (set PORT in .env to change; default 5000)`);
    console.log(`  Health check: ${localUrl}/api/ready`);
    if (forwardedUrl) {
      console.log(`  Codespaces:   ${forwardedUrl}`);
    }
    if (isDev) {
      const urlFile = path.join(process.cwd(), ".local-dev-url");
      try {
        fs.writeFileSync(
          urlFile,
          `# Written on server start — open this file to copy the app URL\nAPP_URL=${localUrl}\nPORT=${port}\n`,
          "utf8",
        );
        console.log(`  URL file:     ${urlFile}  (gitignored, for copy/paste)`);
      } catch {
        // ignore disk errors
      }
    }
    console.log(`${bannerLine}\n`);

    log(`serving on ${host}:${port}`);
    log(`Startup URL (local): ${localUrl}`);
    if (forwardedUrl) {
      log(`Startup URL (Codespaces): ${forwardedUrl}`);
    }
    log(`WebSocket server for real-time inventory sync is active`);
    logger.info("Server listening", {
      host,
      port,
      build: getBuildInfo(),
      runtimeProfile: appEnv.runtimeProfile,
    });
  });
}
