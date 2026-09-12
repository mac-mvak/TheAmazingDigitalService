import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";

/** The slot the HTTP proxy reads on every request. */
export const WORKER_SLOT = "worker";

async function readSlot(ctx: QueryCtx, name: string) {
  return await ctx.db
    .query("proxyTargets")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
}

/**
 * Normalizes an upstream address to a bare origin so that a stored value can
 * never smuggle in a path, query or credentials that would rewrite requests.
 */
function toOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Proxy target must be an absolute URL, got "${raw}"`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Proxy target must be http(s), got "${parsed.protocol}"`);
  }
  return parsed.origin;
}

/** Read by the HTTP proxy; internal so it is not publicly callable. */
export const activeUrl = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await readSlot(ctx, WORKER_SLOT);
    return row?.url ?? null;
  },
});

/** Inspect the configured target (used by the bootstrap and for debugging). */
export const get = query({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await readSlot(ctx, args.name ?? WORKER_SLOT);
    if (row === null) return null;
    return { name: row.name, url: row.url, updatedAt: row.updatedAt };
  },
});

/**
 * Idempotently point a slot at an upstream origin. Re-running with an
 * unchanged URL is a no-op, so container boot can call this every time.
 */
export const upsert = mutation({
  args: { url: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const name = args.name ?? WORKER_SLOT;
    const url = toOrigin(args.url);
    const existing = await readSlot(ctx, name);

    if (existing === null) {
      await ctx.db.insert("proxyTargets", { name, url, updatedAt: Date.now() });
      return { name, url, created: true, changed: true };
    }
    if (existing.url === url) {
      return { name, url, created: false, changed: false };
    }
    await ctx.db.patch(existing._id, { url, updatedAt: Date.now() });
    return { name, url, created: false, changed: true };
  },
});
