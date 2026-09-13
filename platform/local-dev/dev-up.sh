#!/usr/bin/env bash
# One-command local stack for the Agentic Experience Platform.
#
# Brings up the six services the Studio + Hub need, in dependency order, each
# idempotently (a port already listening is left alone) and with a health gate.
# The catalog runs on the embedded H2 `local` profile — no external database.
#
#   ./platform/local-dev/dev-up.sh          # start everything
#   ./platform/local-dev/dev-up.sh studio   # start only the named service(s)
#   ./platform/local-dev/dev-down.sh        # stop everything
#
# Logs stream to platform/local-dev/.logs/<svc>.log (gitignored). Requires
# JDK 21 (catalog) + a built/installed workspace (npm ci at the repo root).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOGS="$ROOT/platform/local-dev/.logs"
mkdir -p "$LOGS"
cd "$ROOT"

# matter-management remote seed — so the Hub's matter-* widgets resolve on load
# (without it the ediscovery pages show "Unknown widget: matter-dashboard").
export SEED_REMOTES='[{"remoteName":"matter-management","version":"1.0.0","remoteEntry":"http://localhost:4301/remoteEntry.json","env":"dev"}]'

port_up()   { lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
health_ok() { local code; code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null); [ "$code" = "200" ]; }

# start <name> <port> <health-url> <workdir> <command...>
start() {
  local name="$1" port="$2" url="$3" dir="$4"; shift 4
  if port_up "$port"; then echo "  • $name  (:$port)  already running — left alone"; return; fi
  echo "  ▸ starting $name  (:$port) …"
  # Fully detach (stdin from /dev/null too) so a long-running dev server never
  # holds the launcher's stdin/stdout open — the script returns after the gate.
  ( cd "$dir" && nohup "$@" >"$LOGS/$name.log" 2>&1 </dev/null & echo $! >"$LOGS/$name.pid" )
}

JDK21="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"

echo "Agentic Experience Platform — local stack"
echo "root: $ROOT"
echo

# Only-named-services filter (default: all).
WANT=("$@"); want() { [ ${#WANT[@]} -eq 0 ] && return 0; for w in "${WANT[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

# 1. Catalog control-plane (Java + H2). Start first — the apps discover it.
if want catalog; then
  if [ -z "$JDK21" ]; then echo "  ✗ catalog: JDK 21 not found (install it / set JAVA_HOME) — skipping"; else
    start catalog 8081 "http://localhost:8081/health" "$ROOT/platform/agentic-catalog-service" \
      env JAVA_HOME="$JDK21" mvn -q spring-boot:run
  fi
fi
# 2. Component-ingest (federation registry) — seeded with matter-management.
want ingest && start ingest 4320 "http://localhost:4320/health" "$ROOT/platform/component-ingest-service" npm run dev
# 3. matter-management MFE remote (:4301) consumed by the Hub.
want mfe && start mfe 4301 "http://localhost:4301/remoteEntry.json" "$ROOT" npx ng serve matter-management-mfe --port 4301
# 4. Agent backend (demo-server) — the Studio copilot + Hub chat talk to it.
if want agent; then
  [ -f "$ROOT/examples/demo-server/.env" ] || echo "  ! agent: examples/demo-server/.env missing (no Gemini key) — copilot will be echo-only"
  start agent 4111 "http://localhost:4111/health" "$ROOT/examples/demo-server" npm run dev
fi
# 5. Experience Studio (authoring).
want studio && start studio 4600 "http://localhost:4600/" "$ROOT" npx ng serve agentic-experience-studio --port 4600
# 6. Experience Hub (runtime).
want hub && start hub 4700 "http://localhost:4700/" "$ROOT" npx ng serve agentic-experience-runtime --port 4700

# ── Health gate ─────────────────────────────────────────────────────────────
echo; echo "waiting for health (up to ~3 min; Angular dev servers compile on first run)…"
declare -a SVCS=("catalog|8081|http://localhost:8081/health"
                 "ingest|4320|http://localhost:4320/health"
                 "mfe|4301|http://localhost:4301/remoteEntry.json"
                 "agent|4111|http://localhost:4111/health"
                 "studio|4600|http://localhost:4600/"
                 "hub|4700|http://localhost:4700/")
for _ in $(seq 1 60); do
  pending=0
  for s in "${SVCS[@]}"; do IFS='|' read -r n p u <<<"$s"; want "$n" || continue; health_ok "$u" || pending=$((pending+1)); done
  [ "$pending" -eq 0 ] && break
  sleep 3
done

echo; printf "%-9s %-7s %s\n" "SERVICE" "PORT" "STATUS"
for s in "${SVCS[@]}"; do
  IFS='|' read -r n p u <<<"$s"; want "$n" || continue
  if health_ok "$u"; then printf "  %-7s %-7s ✓ up\n" "$n" "$p"; else printf "  %-7s %-7s … not healthy yet (see %s)\n" "$n" "$p" "platform/local-dev/.logs/$n.log"; fi
done
echo
echo "Studio → http://localhost:4600    Hub → http://localhost:4700"
echo "Stop with: ./platform/local-dev/dev-down.sh"
