import type { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import type { IncomingMessage } from "http";
import type { WebSocketServer } from "ws";

type Route = { path: string; server: WebSocketServer };
const routesByServer = new WeakMap<HttpServer, Route[]>();

export function registerWebSocketUpgradeRoute(httpServer: HttpServer, path: string, websocketServer: WebSocketServer): void {
  let routes = routesByServer.get(httpServer);
  if (!routes) {
    routes = [];
    routesByServer.set(httpServer, routes);
    httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const route = routesByServer.get(httpServer)?.find((candidate) => candidate.path === pathname);
      if (!route) return;
      route.server.handleUpgrade(request, socket, head, (ws) => route.server.emit("connection", ws, request));
    });
  }
  if (!routes.some((route) => route.path === path)) routes.push({ path, server: websocketServer });
}
