#!/bin/bash
set -e

# Wait for Hasura to become ready
until curl -s http://localhost:8080/healthz; do
  echo "Waiting for Hasura..."
  sleep 2
done

# Apply metadata
curl -s -X POST http://localhost:8080/v1/metadata \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Admin-Secret: testing" \
  -d @/hasura-metadata/uniswap-db-source.json

# Now run the original command
exec graphql-engine serve
