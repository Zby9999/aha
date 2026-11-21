import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import type { ClientMessage, ServerMessage } from "@aha/contracts";
import { WebSocketServer, type WebSocket } from "ws";
import type { Backend } from "./backend.ts";

export interface ServerOptions {
  backend: Backend;
  port: number;
  /** Folder with the built web UI (index.html and assets). */
  uiDir: string;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serves the web UI and a WebSocket at /ws: a snapshot of the Timeline, then each new entry; actions go to the backend. */
export function startServer({ backend, port, uiDir }: ServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = normalize(join(uiDir, url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith(normalize(uiDir)) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });

  const sockets = new WebSocketServer({ server, path: "/ws" });
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

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
