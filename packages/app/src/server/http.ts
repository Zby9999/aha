import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import type { ClientMessage, ServerMessage } from "@aha/contracts";
import { WebSocketServer, type WebSocket } from "ws";
import type { Backend } from "./backend.ts";

export interface ServerOptions {
  backend: Backend;
  port: number;
  /** Interface to listen on. Defaults to loopback so only this computer can reach Aha. */
  host?: string;
  /** Folder with the built web UI (index.html and assets). */
  uiDir: string;
  /** URL of the running project for the live preview pane, served at /api/preview. Null hides the pane. */
  previewUrl?: string | null;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** True when `origin` is a page served by this app on this computer: http on a loopback host at `port`. */
export function isLocalOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && Number(url.port) === port;
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Serves the web UI and a WebSocket at /ws: a snapshot of the Timeline, then each new entry; actions go to the backend.
 * Listens on loopback by default and accepts sockets only from its own page.
 */
export function startServer({ backend, port, uiDir, host = "127.0.0.1", previewUrl = null }: ServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/preview") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ url: previewUrl }));
      return;
    }
    const path = normalize(join(uiDir, url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith(normalize(uiDir)) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });

  // Only the app's own page may open the socket: another website open in the browser could otherwise drive the agent.
  const sockets = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ origin }: { origin: string }) => isLocalOrigin(origin, (server.address() as AddressInfo).port),
  });
  const send = (socket: WebSocket, message: ServerMessage) => socket.send(JSON.stringify(message));
  backend.timeline.subscribe((entry) => {
    for (const socket of sockets.clients) send(socket, { type: "entry", entry });
  });
  sockets.on("connection", (socket) => {
    send(socket, { type: "snapshot", entries: [...backend.timeline.entries()] });
    socket.on("message", async (data) => {
      try {
        const message = JSON.parse(String(data)) as ClientMessage;
        if (message.type === "action") await backend.dispatch(message.action);
      } catch (error) {
        send(socket, { type: "error", message: (error as Error).message });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
