import { httpRouter, ROUTABLE_HTTP_METHODS } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Connection-scoped headers that describe the hop we terminate, not the
 * request itself, so they must not be replayed upstream.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // Let fetch negotiate encoding; it decodes the body for us, so forwarding
  // the client's preference would leave us serving bytes whose
  // content-encoding no longer matches.
  "accept-encoding",
]);

/**
 * Response headers tied to how fetch delivered the body to us. The body we
 * re-emit is already decoded and re-framed, so these would be wrong.
 */
const STRIPPED_RESPONSE_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
];

const forward = httpAction(async (ctx, request) => {
  const target = await ctx.runQuery(internal.targets.activeUrl, {});
  if (target === null) {
    return new Response(
      "Proxy target is not configured in the Convex database.\n",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const incoming = new URL(request.url);
  const upstream = new URL(target);
  // Preserve the path and query verbatim; only the origin is swapped.
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers.append(key, value);
  }
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  const method = request.method.toUpperCase();
  const canHaveBody = method !== "GET" && method !== "HEAD";

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      method,
      headers,
      body: canHaveBody ? await request.arrayBuffer() : undefined,
      // Hand redirects back to the client so the proxy stays transparent.
      redirect: "manual",
    });
  } catch (error) {
    return new Response(`Upstream request failed: ${String(error)}\n`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const header of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(header);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
});

const http = httpRouter();

// Catch-all: every method on every path is reverse-proxied upstream. HEAD is
// normalized to GET by the router, so the six routable methods cover it.
for (const method of ROUTABLE_HTTP_METHODS) {
  http.route({ pathPrefix: "/", method, handler: forward });
}

export default http;
