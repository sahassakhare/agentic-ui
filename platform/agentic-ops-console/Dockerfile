# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for @infra-tools/agentic-ops-console.
#
# Stage 1 (builder) runs `ng build` to produce the static bundle.
# Stage 2 (runtime) is nginx-alpine serving the bundle. Total image
# size ~30 MB; the entire app is static assets so an HTTP server is
# all we need.
#
# Build (from the repo root, NOT this directory — the Angular build
# needs the workspace's angular.json):
#
#   docker build -t agentic-ops-console:0.1.0 \
#     -f platform/agentic-ops-console/Dockerfile .
#
# Run:
#
#   docker run --rm -p 4500:80 agentic-ops-console:0.1.0
#
# The default config serves on :80 and proxies `/v1/*` to the catalog
# server at the env var CATALOG_BACKEND (default
# http://catalog-server:8080) — so the ops console fetches the
# catalog same-origin and avoids CORS pre-flights.

# ──────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.json angular.json ./
COPY .npmrc ./
COPY projects ./projects
COPY platform/agentic-ops-console ./platform/agentic-ops-console
COPY scripts ./scripts

RUN npm ci --no-audit --fund=false
# Build the lib first — ops-console imports nothing from it today,
# but the workspace's tsconfig path mappings reach into dist/agentic-ui.
RUN npx ng build agentic-ui --configuration production
RUN npx ng build agentic-ops-console --configuration production

# ──────────────────────────────────────────────────────────────────────
# Stage 2 — runtime (nginx-alpine)
# ──────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# The Angular build output:
COPY --from=builder /workspace/dist/agentic-ops-console/browser /usr/share/nginx/html

# Custom nginx config: SPA fallback to index.html + reverse-proxy
# /v1/* → catalog. The CATALOG_BACKEND env var is interpolated at
# container start via envsubst so operators can swap targets without
# rebuilding the image.
COPY platform/agentic-ops-console/nginx.conf.template /etc/nginx/templates/default.conf.template

ENV CATALOG_BACKEND=http://catalog-server:8080

EXPOSE 80

# nginx-alpine's entrypoint already runs `envsubst` over
# /etc/nginx/templates/*.template at boot.
