import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ROLES } from "./config/roles.ts";
import type { EventBus } from "./events.ts";

const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
// three.js is served from node_modules so the office works offline, no CDN.
const THREE_DIR = fileURLToPath(new URL("../node_modules/three/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error("body too large");
  }
  return body;
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Serves the 3D office and streams bus events over WebSocket. The UI only
 * listens, so watching the company costs no tokens.
 */
export function startServer(bus: EventBus, submit: (request: string) => void, port: number) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/roles") {
        return json(
          res,
          200,
          Object.values(ROLES).map(({ id, title, model, desk }) => ({ id, title, model, desk })),
        );
      }
      if (url.pathname === "/api/tasks" && req.method === "POST") {
        const { request } = JSON.parse(await readBody(req)) as { request?: string };
        if (!request?.trim()) return json(res, 400, { error: "request is required" });
        submit(request.trim());
        return json(res, 202, { queued: true });
      }
      const vendor = url.pathname.startsWith("/vendor/three/");
      const rel = vendor ? url.pathname.slice("/vendor/three/".length) : url.pathname.slice(1);
      const file = normalize(rel || "index.html");
      if (file.startsWith("..")) return json(res, 404, { error: "not found" });
      const content = await readFile(join(vendor ? THREE_DIR : WEB_DIR, file));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(content);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
      json(res, code, { error: code === 404 ? "not found" : String(err) });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ kind: "history", events: bus.recent() }));
  });
  bus.subscribe((event) => {
    const data = JSON.stringify({ kind: "event", event });
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(data);
  });

  server.listen(port, () => {
    console.log(`RCS office: http://localhost:${port}`);
  });
  return server;
}
