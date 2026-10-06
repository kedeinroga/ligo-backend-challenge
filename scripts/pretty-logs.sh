#!/usr/bin/env bash
# Human friendly view of the API's JSON logs (local development only).
#   npm run start:dev:pretty            (dev server)
#   npm run logs                        (API running in docker compose)
#   docker compose logs -f --no-log-prefix api | scripts/pretty-logs.sh
# Lines that are not JSON (Nest watch output) pass through unchanged. Needs jq.
set -uo pipefail
command -v jq >/dev/null || { echo "pretty-logs: jq is required (brew install jq)" >&2; cat; exit 0; }

jq --unbuffered -rR '
  def color: {"info": "\u001b[32m", "warn": "\u001b[33m", "error": "\u001b[31m"}[.] // "";
  def causes: if . == null then "" elif type == "object" then " <- \(.name): \(.message)\(.cause | causes)" else " <- \(.)" end;
  . as $raw
  | (try fromjson catch null) as $log
  | if ($log | type) != "object" then $raw
    else $log
      | "\(.time // "" | .[11:23]) \(.level | color)\(.level | ascii_upcase | .[0:5])\u001b[0m "
        + "\(.message)"
        + (if .context then "  [\(.context)]" else "" end)
        + (if .method then "  \(.method) \(.url // .path)" else "" end)
        + (if .statusCode then "  \(.statusCode)" else "" end)
        + (if .durationMs != null then " \(.durationMs)ms" else "" end)
        + (if .code then "  \(.code)" else "" end)
        + (if .traceId then "  trace=\(.traceId)" else "" end)
        + (if .error then "\n      \(.error.name // "Error"): \(.error.message // .error)\(.error.cause | causes)" else "" end)
    end'
