#!/bin/bash
# Starts the VarLens web server for the parity crawl (port 8900, metrics 9200).
cd /home/bernt-popp/development/VarLens/.claude/worktrees/agent-a441a5be6bf38012d || exit 1
set -a
# Developer-local configuration is intentionally absent from the repository.
# shellcheck source=/dev/null
. ./.env.postgres.local
# shellcheck source=/dev/null
. ./.env.web.local
set +a
export NODE_ENV=development APP_PATH_PREFIX=/ VARLENS_WEB_HOST=127.0.0.1 VARLENS_WEB_PORT=8900 \
  VARLENS_METRICS_PORT=9200 VARLENS_METRICS_HOST=127.0.0.1 VARLENS_WEB_API_LATENCY_MS=0 \
  VARLENS_PG_SCHEMA=web_dev_parity VARLENS_RECOVERY_KEY_DIR=/tmp/varlens-docs-desktop-web-parity-spec
exec node out/web/server.cjs
