import { createFalClient } from "@fal-ai/client";

// Browser-side client. All credentialed requests are routed through our Worker
// proxy, which attaches FAL_KEY server-side.
export const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
