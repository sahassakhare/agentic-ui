#!/usr/bin/env bash
# Stop the local Agentic Experience Platform stack started by dev-up.sh.
#   ./platform/local-dev/dev-down.sh          # stop everything
#   ./platform/local-dev/dev-down.sh studio   # stop only the named service(s)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOGS="$ROOT/platform/local-dev/.logs"

declare -a SVCS=("catalog|8081" "ingest|4320" "mfe|4301" "agent|4111" "studio|4600" "hub|4700")
WANT=("$@"); want() { [ ${#WANT[@]} -eq 0 ] && return 0; for w in "${WANT[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

for s in "${SVCS[@]}"; do
  IFS='|' read -r n p <<<"$s"; want "$n" || continue
  pids=$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null)
  if [ -n "$pids" ]; then echo "  ✗ stopping $n (:$p)"; kill $pids 2>/dev/null; else echo "  · $n (:$p) not running"; fi
  rm -f "$LOGS/$n.pid" 2>/dev/null
done
echo "done."
