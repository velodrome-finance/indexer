#!/bin/sh


check_hasura_health() {
    while true; do
        # Use curl to get the HTTP status code of the /healthz endpoint
        HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}\n" "http://$HASURA_SERVICE_HOST:$HASURA_SERVICE_PORT/healthz")

        # Check if the HTTP status code is 200 (OK)
        if [ "$HTTP_STATUS" -eq 200 ]; then
            echo "Hasura service is healthy."
            break
        else
            echo "Waiting for Hasura service to become healthy..."
            sleep 5
        fi
    done
}


check_hasura_health
export TUI_OFF=${TUI_OFF} # should use TUI (set to true by default in docker compose)

# the migrate step below is only required if hasura is being used
echo "running indexer migrations..."
pnpm envio local db-migrate up || true
export NODE_OPTIONS=--max-old-space-size=800 # conservative here, can be increased if needed
echo "starting indexer..."
pnpm envio start
