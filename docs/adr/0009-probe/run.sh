#!/usr/bin/env bash
# Run pcmin against the scratch stack with its own databases (velo_pc_min).
# Usage: run.sh <logfile> [envio start args...]
set -euo pipefail
H=/home/dev/work-dev-box/hosting/velodrome-indexer
cd "$(dirname "$0")"
LOGFILE=$1; shift
set -a
. "$H/stacks/scratch.secret.env"
set +a
ENVIO_API_TOKEN=$(grep '^ENVIO_API_TOKEN=' "$H/secrets/indexer.env" | cut -d= -f2-)
export PATH=$HOME/.local/node/current/bin:/usr/bin:/bin
exec env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 \
  ENVIO_API_TOKEN="$ENVIO_API_TOKEN" \
  ENVIO_PG_HOST=127.0.0.1 ENVIO_PG_PORT=5460 ENVIO_PG_USER=postgres ENVIO_PG_PASSWORD="$PG_PASSWORD" \
  ENVIO_PG_DATABASE=velo_pc_min ENVIO_PG_SCHEMA="${PGSCHEMA:-public}" ENVIO_PG_SSL_MODE=false \
  ENVIO_PG_MAX_CONNECTIONS="${MAXCONN:-10}" \
  ENVIO_CLICKHOUSE_HOST=http://127.0.0.1:8160 ENVIO_CLICKHOUSE_DATABASE="${CHDB:-velo_pc_min}" \
  ENVIO_CLICKHOUSE_USERNAME=velo ENVIO_CLICKHOUSE_PASSWORD="$CH_PASSWORD" \
  ENVIO_INDEXER_PORT=9979 ENVIO_HASURA=false ENVIO_TUI=false \
  PCMIN_EFFECT_LOG="$PWD/effect-calls.log" \
  node node_modules/envio/bin.mjs start "$@" >"$LOGFILE" 2>&1
