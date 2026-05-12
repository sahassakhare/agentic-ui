# Multi-stage Dockerfile for the eDiscovery agent server.
#
# Builds the workspace (the server depends on the @infra-tools/agentic-ui-server
# library and @infra-tools/demo-ediscovery-shared, both of which live in the
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
#                                   https://ediscovery-shell.onrender.com
#                                   Defaults to "*" (open). Lock down in prod.
#   AGENT_AUTH_TOKENS             — optional bearer-token allow-list
#                                   (comma-separated). When unset, /agents
#                                   is open (matches dev behaviour).
#
# Base image choice:
#   node:22-bookworm-slim (Debian, glibc) over node:22-alpine (musl). The
#   workspace pulls in @playwright/test as a dev-dep whose Chromium
#   postinstall is glibc-only, plus a handful of less-common native deps
#   that lean on Debian tooling. Slim is ~250MB vs alpine's ~60MB —
#   acceptable for a single backend service deploy.

# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# Skip browser / native-binary postinstalls the runtime image doesn't need.
# Keeps the build fast and avoids pulling Chromium / Firefox tarballs into
# the build layer.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CYPRESS_INSTALL_BINARY=0

# Install workspace deps with the lockfile honoured.
COPY package.json package-lock.json ./
COPY tsconfig*.json angular.json ./
COPY projects/ projects/
COPY examples/demo-ediscovery-shared/ examples/demo-ediscovery-shared/
COPY examples/demo-ediscovery-server/  examples/demo-ediscovery-server/
COPY scripts/ scripts/

# Pin npm to a version known to accept this repo's lockfile. npm 10.9.7
# does stricter transitive-dep resolution than 10.9.4 and rejects valid
# entries (`Missing: @module-federation/runtime-core@x.y.z`). Pin solves
# the version drift between local dev and Render's builder.
RUN npm install --global npm@10.9.4

# Use `install` not `ci` so the lockfile is reconciled if the local repo
# was generated with a different npm version. Slightly slower but does
# not hard-fail on minor lockfile inconsistencies.
RUN npm install --no-audit --no-fund

# Build in dependency order. Each `file:` workspace dep must have its
# dist/ in place before the server's npm install resolves it (TypeScript
# follows the symlink to find dist/index.d.ts), and the server's own
# deps (@google/genai, hono, dotenv) are NOT in the root package.json
# so they need a separate install in the server folder.
#
#   1. @infra-tools/agentic-ui          (Angular library — consumed by the demos)
#   2. @infra-tools/agentic-ui-server   (Node lib — consumed by the demo server)
#   3. @infra-tools/demo-ediscovery-shared  (mock data + types)
#   4. Install the server's own deps (now that file: deps have dist/)
#   5. Build the server itself
RUN npm run build:lib \
 && npm --prefix projects/agentic-ui-server               run build \
 && npm --prefix examples/demo-ediscovery-shared          run build \
 && npm --prefix examples/demo-ediscovery-server install  --no-audit --no-fund \
 && npm --prefix examples/demo-ediscovery-server          run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy only what the runtime needs.
#
# node_modules layout: workspace root + server-local merged. The server's
# package.json declares its own runtime deps (dotenv, hono, @google/genai,
# @hono/node-server) which npm installs into
# examples/demo-ediscovery-server/node_modules/ rather than hoisting to
# the root (no workspaces declaration). Both directories COPY into the
# same target so the merged tree resolves both root deps AND server deps.
#
# file: deps (`@infra-tools/agentic-ui-server`, `@infra-tools/demo-ediscovery-shared`)
# install as symlinks pointing back into the build stage's filesystem
# layout — those symlinks would dangle in the runtime image. Override
# both with explicit COPYs of the built dist + package.json so the
# import resolver finds real files at /app/node_modules/@infra-tools/<lib>.
COPY --from=build /repo/examples/demo-ediscovery-server/dist /app/dist
COPY --from=build /repo/examples/demo-ediscovery-server/package.json /app/package.json

# 1. Workspace-root deps (foundation).
COPY --from=build /repo/node_modules /app/node_modules

# 2. Server-local deps merged on top (dotenv, hono, @google/genai, …).
#    npm installed these into examples/demo-ediscovery-server/node_modules
#    because the workspace doesn't declare workspaces. Merging into the
#    same /app/node_modules tree lets module resolution walk up from
#    /app/dist/server.js and find both root and server-specific deps.
COPY --from=build /repo/examples/demo-ediscovery-server/node_modules /app/node_modules

# 3. Replace the file:-dep symlinks with REAL directories. npm creates
#    these symlinks with relative targets (../../../projects/…). In the
#    runtime image those targets don't exist; if we COPY into the
#    symlink path, Docker follows it and writes the files at
#    /projects/agentic-ui-server/ instead of /app/node_modules/@infra-tools/…
#    — and Node's module resolver won't find transitive deps like
#    @ag-ui/core that live in /app/node_modules/. Delete the symlink
#    first so the COPY creates a real directory at the intended path.
RUN rm -rf /app/node_modules/@infra-tools/agentic-ui-server \
           /app/node_modules/@infra-tools/demo-ediscovery-shared
COPY --from=build /repo/projects/agentic-ui-server/dist /app/node_modules/@infra-tools/agentic-ui-server/dist
COPY --from=build /repo/projects/agentic-ui-server/package.json /app/node_modules/@infra-tools/agentic-ui-server/package.json
COPY --from=build /repo/examples/demo-ediscovery-shared/dist /app/node_modules/@infra-tools/demo-ediscovery-shared/dist
COPY --from=build /repo/examples/demo-ediscovery-shared/package.json /app/node_modules/@infra-tools/demo-ediscovery-shared/package.json

# Run as non-root for safer container privilege.
USER node

# Bind to whatever PORT the platform injects; default 4311 for local docker run.
ENV PORT=4311
EXPOSE 4311

# Lightweight healthcheck so platforms can detect a wedged process.
# wget is in the bookworm-slim base by default; no apt-get needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "--enable-source-maps", "dist/server.js"]
