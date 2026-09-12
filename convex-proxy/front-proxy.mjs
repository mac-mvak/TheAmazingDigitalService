/**
 * Render routes public traffic to a single port, but the Convex backend serves
 * its client/admin API on 3210 and its HTTP actions on 3211. This fronts both
 * on $PORT so that:
 *
 *   /version, /instance_name, /api/*  -> 3210  (health check + Convex API)
 *   /_convex/*                        -> 3210  (same, with the prefix stripped)
 *   everything else                   -> 3211  (the catch-all proxy action)
 *
 * The upstream worker 404s on those reserved paths, so nothing it serves is
 * shadowed by this split.
 */
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT ?? 10000);
const HOST = "127.0.0.1";
const API_PORT = Number(process.env.CONVEX_API_PORT ?? 3210);
const SITE_PORT = Number(process.env.CONVEX_SITE_PORT ?? 3211);

const API_EXACT_PATHS = new Set(["/version", "/instance_name"]);
const CONTROL_PREFIX = "/_convex";

/** Decide which internal port serves a request, and under what path. */
function route(requestUrl) {
  const path = requestUrl.split("?", 1)[0];

  if (path === CONTROL_PREFIX || path.startsWith(`${CONTROL_PREFIX}/`)) {
    const rest = requestUrl.slice(CONTROL_PREFIX.length);
    return { port: API_PORT, path: rest === "" ? "/" : rest };
  }
  if (API_EXACT_PATHS.has(path) || path === "/api" || path.startsWith("/api/")) {
    return { port: API_PORT, path: requestUrl };
  }
  return { port: SITE_PORT, path: requestUrl };
}

const server = http.createServer((clientReq, clientRes) => {
  const target = route(clientReq.url ?? "/");

  const upstreamReq = http.request(
    {
      host: HOST,
      port: target.port,
      method: clientReq.method,
      path: target.path,
      headers: clientReq.headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.on("error", (error) => {
    if (clientRes.headersSent) {
      clientRes.destroy();
      return;
    }
    // The backend is still booting or has crashed; make that legible rather
    // than hanging the client.
    clientRes.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    clientRes.end(`Convex backend unreachable on port ${target.port}: ${error.message}\n`);
  });

  clientReq.on("error", () => upstreamReq.destroy());
  clientReq.pipe(upstreamReq);
});

// Convex clients speak the sync protocol over a WebSocket on the API port.
server.on("upgrade", (clientReq, clientSocket, head) => {
  const target = route(clientReq.url ?? "/");
  const upstreamSocket = net.connect(target.port, HOST, () => {
    const headerLines = Object.entries(clientReq.headers).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map((v) => `${key}: ${v}\r\n`),
    );
    upstreamSocket.write(
      `${clientReq.method} ${target.path} HTTP/1.1\r\n${headerLines.join("")}\r\n`,
    );
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket).pipe(upstreamSocket);
  });

  const teardown = () => {
    clientSocket.destroy();
    upstreamSocket.destroy();
  };
  upstreamSocket.on("error", teardown);
  clientSocket.on("error", teardown);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[front-proxy] listening on 0.0.0.0:${PORT} -> api ${API_PORT} / site ${SITE_PORT}`,
  );
});
