# Multi-stage Dockerfile for the eDiscovery agent server.
#
# Builds the workspace (the server depends on the @maverick/agentic-ui-server
# library and @maverick/demo-ediscovery-shared, both of which live in the
# same monorepo) and ships a slim runtime image.
#
# Build context MUST be the repo root, not this folder. From repo root:
#   docker build -f examples/demo-ediscovery-server/Dockerfile -t ediscovery-server .
#
# Runtime env vars (set in your platform's dashboard):
#   GOOGLE_GENERATIVE_AI_API_KEY  — Gemini key (required; falls back to echo)
#   GEMINI_MODEL                  — default "gemini-2.5-flash"
#   PORT                          — default 4311
#   CORS_ORIGINS                  — comma-separated allow-list, e.g.
#                                   https://ediscovery-shell.netlify.app
#                                   Defaults to "*" (open). Lock down in prod.
#   AGENT_AUTH_TOKENS             — optional bearer-token allow-list
#                                   (comma-separated). When unset, /agents
#                                   is open (matches dev behaviour).

# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo

# Install workspace deps with the lockfile honoured.
COPY package.json package-lock.json ./
COPY tsconfig*.json angular.json ./
COPY projects/ projects/
COPY examples/demo-ediscovery-shared/ examples/demo-ediscovery-shared/
COPY examples/demo-ediscovery-server/  examples/demo-ediscovery-server/
COPY scripts/ scripts/

RUN npm ci --no-audit --no-fund

# Build in dependency order:
#   1. @maverick/agentic-ui (the library the server consumes)
#   2. @maverick/demo-ediscovery-shared (mock data + types)
#   3. The server itself
RUN npm run build:lib \
 && npm --prefix examples/demo-ediscovery-shared run build \
 && npm --prefix examples/demo-ediscovery-server  run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy only what the runtime needs:
#   - the server's compiled output
#   - the workspace node_modules (so the server's imports resolve)
#   - the shared package (for `@maverick/demo-ediscovery-shared`)
#   - the agentic-ui-server library
COPY --from=build /repo/examples/demo-ediscovery-server/dist /app/dist
COPY --from=build /repo/examples/demo-ediscovery-server/package.json /app/package.json
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/examples/demo-ediscovery-shared/dist /app/node_modules/@maverick/demo-ediscovery-shared/dist
COPY --from=build /repo/examples/demo-ediscovery-shared/package.json /app/node_modules/@maverick/demo-ediscovery-shared/package.json

# Run as non-root for safer container privilege.
USER node

# Bind to whatever PORT the platform injects; default 4311 for local docker run.
ENV PORT=4311
EXPOSE 4311

# Lightweight healthcheck so platforms can detect a wedged process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "--enable-source-maps", "dist/server.js"]
