import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // The address of the Cloudflare Worker that actually serves the application.
  // Convex holds it so the poller has a single source of truth that can be
  // repointed at runtime without redeploying anything.
  endpoints: defineTable({
    name: v.string(),
    url: v.string(),
    path: v.string(),
    intervalSeconds: v.number(),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  // One row per poll of the worker.
  pings: defineTable({
    endpointName: v.string(),
    url: v.string(),
    ok: v.boolean(),
    status: v.optional(v.number()),
    latencyMs: v.number(),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_endpoint_time", ["endpointName", "checkedAt"]),
});
