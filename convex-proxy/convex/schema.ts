import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The proxy target lives in the database rather than in an env var so the
// upstream can be repointed at runtime without rebuilding the container.
export default defineSchema({
  proxyTargets: defineTable({
    // Logical slot name. The HTTP proxy always reads the "worker" slot.
    name: v.string(),
    // Absolute origin requests are forwarded to, e.g. "https://example.workers.dev".
    url: v.string(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
});
