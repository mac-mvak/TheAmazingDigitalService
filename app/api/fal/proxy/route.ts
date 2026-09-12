import { env } from "cloudflare:workers";

// Mirrors the @fal-ai/server-proxy contract: the browser client is created with
// proxyUrl pointing here and puts the real fal URL in x-fal-target-url; we attach
// the account key server-side so it never reaches the browser.
// NOTE: demo-only — there is no auth gate yet. Add one (e.g. requireChatGPTUser)
// before deploying this route anywhere public: an open proxy is unmetered spend.
const TARGET_HEADER = "x-fal-target-url";
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "x-fal-object-lifecycle"];

function isAllowedTarget(url: URL) {
  const host = url.hostname;
  return (
    url.protocol === "https:" &&
    (host === "fal.ai" || host.endsWith(".fal.ai") || host === "fal.run" || host.endsWith(".fal.run"))
  );
}

async function proxy(request: Request) {
  const target = request.headers.get(TARGET_HEADER);
  if (!target) return new Response(`Missing ${TARGET_HEADER} header`, { status: 400 });

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response("Invalid target URL", { status: 400 });
  }
  if (!isAllowedTarget(url)) return new Response("Target not allowed", { status: 403 });
  if (!env.FAL_KEY) return new Response("FAL_KEY is not configured", { status: 500 });

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Key ${env.FAL_KEY}`);

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const response = await fetch(url, { method: request.method, headers, body });

  const responseHeaders = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
