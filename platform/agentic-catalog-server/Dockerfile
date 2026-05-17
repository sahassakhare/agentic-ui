# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for @infra-tools/agentic-catalog-server.
#
# Stage 1 (builder) installs all dependencies + compiles TypeScript.
# Stage 2 (runtime) is `gcr.io/distroless/nodejs22-debian12:nonroot` —
# minimal attack surface, no shell, non-root user, ~80 MB final image.
#
# Build:
#   docker build -t agentic-catalog-server:0.1.0 -f Dockerfile .
#
# Run (assumes DATABASE_URL + OIDC_* env vars are set):
#   docker run --rm -p 8080:8080 \
#     -e DATABASE_URL=postgres://... \
#     -e OIDC_ISSUER=https://... \
#     -e OIDC_AUDIENCE=agentic-catalog \
#     agentic-catalog-server:0.1.0

# ──────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Cache deps layer separately from sources for faster rebuilds.
COPY package.json package-lock.json* ./
# `npm ci` requires lockfile; `npm install` is the fallback when the
# package isn't yet published + lockfile isn't committed.
RUN npm install --no-audit --fund=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Drop devDependencies for the runtime stage. Re-installing prod-only
# is the cleanest way to get a small `node_modules`.
RUN npm prune --omit=dev

# ──────────────────────────────────────────────────────────────────────
# Stage 2 — runtime (distroless)
# ──────────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

# Bring over the compiled output + production node_modules.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Migrations need to be available at runtime if the operator uses the
# server's bundled migrate command. Most production deployments run
# migrations separately via CI; we ship them anyway for parity.
COPY --from=builder /app/src/db/migrations ./src/db/migrations

# Environment defaults — override at deploy time.
ENV NODE_ENV=production \
    PORT=8080 \
    LOG_LEVEL=info \
    LOG_FORMAT=json

EXPOSE 8080

# Distroless image's entrypoint is `node`. We pass the compiled entry.
CMD ["dist/server.js"]
