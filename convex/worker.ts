import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";

// The Cloudflare Worker that actually serves Folio. Convex stores this in the
// `endpoints` table; the constant is only the value used to seed an empty
// database, so the stored row always wins.
const ENDPOINT_NAME = "folio-worker";
const DEFAULT_WORKER_URL =
  "https://folio-video-assistant.theamazingdigitalservice.workers.dev";
const DEFAULT_POLL_PATH = "/";
const DEFAULT_INTERVAL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;
const PINGS_RETAINED = 500;

// Annotated explicitly: `poll` calls `ensureSeeded` in this same file, and
// without these the types become circular and stop inferring.
type PollResult =
  | { skipped: true; url: string }
  | {
      skipped: false;
      url: string;
      ok: boolean;
      status?: number;
      latencyMs: number;
      error?: string;
    };

export const get = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      url: v.string(),
      path: v.string(),
      intervalSeconds: v.number(),
      enabled: v.boolean(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const endpoint = await ctx.db
      .query("endpoints")
      .withIndex("by_name", (q) => q.eq("name", ENDPOINT_NAME))
      .unique();
    if (!endpoint) return null;
    const { name, url, path, intervalSeconds, enabled, updatedAt } = endpoint;
    return { name, url, path, intervalSeconds, enabled, updatedAt };
  },
});

export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 200);
    return await ctx.db
      .query("pings")
      .withIndex("by_endpoint_time", (q) => q.eq("endpointName", ENDPOINT_NAME))
      .order("desc")
      .take(limit);
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const endpoint = await ctx.db
      .query("endpoints")
      .withIndex("by_name", (q) => q.eq("name", ENDPOINT_NAME))
      .unique();
    const recent = await ctx.db
      .query("pings")
      .withIndex("by_endpoint_time", (q) => q.eq("endpointName", ENDPOINT_NAME))
      .order("desc")
      .take(50);
    const latest = recent[0] ?? null;
    const healthy = recent.filter((ping) => ping.ok).length;
    return {
      endpoint: endpoint
        ? { url: endpoint.url, path: endpoint.path, enabled: endpoint.enabled }
        : null,
      latest,
      sampled: recent.length,
      okRate: recent.length ? healthy / recent.length : null,
      averageLatencyMs: recent.length
        ? Math.round(
            recent.reduce((total, ping) => total + ping.latencyMs, 0) /
              recent.length,
          )
        : null,
    };
  },
});

// Repoint the poller at a different worker without redeploying.
export const setWorkerUrl = mutation({
  args: {
    url: v.string(),
    path: v.optional(v.string()),
    intervalSeconds: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const url = new URL(args.url).origin;
    const existing = await ctx.db
      .query("endpoints")
      .withIndex("by_name", (q) => q.eq("name", ENDPOINT_NAME))
      .unique();
    const patch = {
      name: ENDPOINT_NAME,
      url,
      path: args.path ?? existing?.path ?? DEFAULT_POLL_PATH,
      intervalSeconds:
        args.intervalSeconds ?? existing?.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
      enabled: args.enabled ?? existing?.enabled ?? true,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { created: false, ...patch };
    }
    await ctx.db.insert("endpoints", patch);
    return { created: true, ...patch };
  },
});

// Seeds the row on first boot so a fresh database still knows where the
// worker lives, and returns whatever is stored.
export const ensureSeeded = internalMutation({
  args: {},
  handler: async (ctx): Promise<Doc<"endpoints">> => {
    const existing = await ctx.db
      .query("endpoints")
      .withIndex("by_name", (q) => q.eq("name", ENDPOINT_NAME))
      .unique();
    if (existing) return existing;
    const seeded = {
      name: ENDPOINT_NAME,
      url: DEFAULT_WORKER_URL,
      path: DEFAULT_POLL_PATH,
      intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      enabled: true,
      updatedAt: Date.now(),
    };
    const id = await ctx.db.insert("endpoints", seeded);
    return (await ctx.db.get(id))!;
  },
});

export const record = internalMutation({
  args: {
    url: v.string(),
    ok: v.boolean(),
    status: v.optional(v.number()),
    latencyMs: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pings", {
      endpointName: ENDPOINT_NAME,
      url: args.url,
      ok: args.ok,
      status: args.status,
      latencyMs: args.latencyMs,
      error: args.error,
      checkedAt: Date.now(),
    });

    // Keep the table bounded; this runs every minute forever.
    const stale = await ctx.db
      .query("pings")
      .withIndex("by_endpoint_time", (q) => q.eq("endpointName", ENDPOINT_NAME))
      .order("desc")
      .take(PINGS_RETAINED + 100);
    for (const ping of stale.slice(PINGS_RETAINED)) {
      await ctx.db.delete(ping._id);
    }
  },
});

async function pollOnce(ctx: ActionCtx): Promise<PollResult> {
  const endpoint: Doc<"endpoints"> = await ctx.runMutation(
    internal.worker.ensureSeeded,
    {},
  );
  if (!endpoint.enabled) {
    return { skipped: true, url: endpoint.url };
  }

  const target = new URL(endpoint.path, endpoint.url).toString();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "convex-folio-poller" },
    });
    // Drain the body so the connection closes cleanly and the timing is honest.
    await response.arrayBuffer();
    const latencyMs = Date.now() - startedAt;
    await ctx.runMutation(internal.worker.record, {
      url: target,
      ok: response.ok,
      status: response.status,
      latencyMs,
    });
    return {
      skipped: false,
      url: target,
      ok: response.ok,
      status: response.status,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.worker.record, {
      url: target,
      ok: false,
      latencyMs,
      error: message,
    });
    return { skipped: false, url: target, ok: false, latencyMs, error: message };
  } finally {
    clearTimeout(timer);
  }
}

// Called by the cron in convex/crons.ts.
export const poll = internalAction({
  args: {},
  handler: async (ctx): Promise<PollResult> => await pollOnce(ctx),
});

// Same thing, callable by hand: `npx convex run worker:pollNow`.
export const pollNow = action({
  args: {},
  handler: async (ctx): Promise<PollResult> => await pollOnce(ctx),
});
