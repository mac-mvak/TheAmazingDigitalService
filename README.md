# TheAmazingDigitalService

## Folio video assistant

A responsive TypeScript/React workspace with a vertical video, text composer, and three selectable assistants. Includes portrait playback, pause, captions, browser speech, expanded video, a transcript, and accessible keyboard navigation.

### Run locally

```sh
npm install
npm run dev
```

The app uses Vinext with React 19. `npm run build` builds the production Worker and client assets. `npx tsc --noEmit` checks TypeScript.

### Convex on Render (worker health poller)

The application keeps running as the Cloudflare Worker. A self-hosted Convex
deployment on Render holds the worker's address and polls it every minute, so
the worker's availability and latency are recorded outside Cloudflare.

- `convex/schema.ts` — `endpoints` (the worker address, one row) and `pings`
  (one row per poll, capped at the most recent 500).
- `convex/worker.ts` — `worker:get` / `worker:status` / `worker:history` read
  it, `worker:setWorkerUrl` repoints the poller at a different address without a
  redeploy, and `worker:poll` performs one HTTP GET and records the result.
- `convex/crons.ts` — runs `worker:poll` on a 60 second interval, which is
  Convex's shortest supported interval.
- `render.yaml` — the Render service: the public `ghcr.io/get-convex/convex-backend`
  image on a paid instance type with a 1 GB disk mounted at `/convex/data`,
  which is where the backend's SQLite database lives. Without that disk the
  deployment is wiped on every restart. `INSTANCE_SECRET` is not committed;
  generate it with `openssl rand -hex 32`.

Render publishes one port per service, so the backend is reachable on 3210
(client/CLI traffic) and its HTTP actions port, 3211, is not exposed. Nothing
here uses HTTP actions.

The deployment is live at `https://convex-folio.onrender.com` (Render service
`srv-dain6k8jo6nc73fjmdqg`, Oregon). Render terminates TLS on 443 at its edge
and routes by hostname, so the backend's own port 3210 is not addressed
directly from outside.

Push functions to it from a checkout with the admin key obtained from the
running container. The key is not committed; regenerate it at any time with a
Render one-off job:

```sh
render jobs create srv-dain6k8jo6nc73fjmdqg --start-command "./generate_admin_key.sh"
render logs --resources <job-id>   # the key is printed in the job's own logs
```


```sh
export CONVEX_SELF_HOSTED_URL=https://convex-folio.onrender.com
export CONVEX_SELF_HOSTED_ADMIN_KEY=...
npx convex deploy
npx convex run worker:pollNow      # poll immediately instead of waiting for the cron
npx convex run worker:status       # ok rate and average latency over recent polls
```

The address is seeded automatically on the first poll, so a fresh database
still knows where the worker is. To change it:

```sh
npx convex run worker:setWorkerUrl '{"url":"https://example.workers.dev"}'
```

### Deploy to Cloudflare

The root `wrangler.jsonc` configures the `folio-video-assistant` Worker. Vite emits the deployable configuration in `dist/server/wrangler.json`; do not edit that generated file.

With Doppler CLI signed in and the two Cloudflare credentials stored in `ai-vision` → `dev_personal`, run:

```sh
npm run deploy:doppler
```

This builds first, then reads only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` into the deployment process. It does not write them to disk or upload them as application secrets. Other Doppler API keys are not loaded.

Alternatively, use `npm run deploy` with Wrangler already authenticated or the two Cloudflare variables supplied by your CI secret store. Both commands build before publishing. The Worker is accessible at its public `workers.dev` URL; preview URLs are disabled. The existing Sites preview is a separate deployment.

Deployment is manual; no GitHub Actions workflow is configured yet. The current application is maintained on `main`; use feature branches for further development.

### Demo behavior

This is a frontend prototype. Messages receive guided sample replies; portrait videos are prerecorded stock clips and are not lip-synced. Audio uses the browser’s SpeechSynthesis API when enabled. Conversations live in memory and clear on refresh. No messages are sent to an AI service.

To enable live responses, replace `demoReply` and the delayed response in `app/page.tsx` with a server-side AI integration and a licensed avatar video/streaming provider. Keep provider credentials on the server and supply the returned stream or video URL to the player.

Assistant selection is also exposed through the optional `select_assistant` WebMCP tool in supported browsers.

### Media

Sample portraits and clips are from Pexels. Provenance and source URLs are in `public/assistants/sources.json`. The fictional assistant identities do not imply endorsement by the people depicted.
