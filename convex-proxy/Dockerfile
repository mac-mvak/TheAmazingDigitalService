# Self-hosted Convex backend plus the proxy functions it should serve.
#
# The upstream image already ships node and npm (it needs them for Node
# actions), so the Convex CLI can run inside the container and push the
# functions into the local instance at boot. See bootstrap.sh.
FROM ghcr.io/get-convex/convex-backend:latest

WORKDIR /convex/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY convex ./convex
COPY front-proxy.mjs ./
COPY --chmod=755 bootstrap.sh /convex/bootstrap.sh

WORKDIR /convex

# Render publishes a single port; the front proxy binds it and fans out to the
# backend's API (3210) and HTTP action (3211) ports.
ENV PORT=10000
EXPOSE 10000

ENTRYPOINT ["/convex/bootstrap.sh"]
