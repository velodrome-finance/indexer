#!/bin/sh

export TUI_OFF=${TUI_OFF} # should use TUI (set to true by default in docker compose)

(cd generated && pnpm rescript build -with-deps)

echo "running indexer migrations..."
sleep 2
(cd generated && node -e "require('./src/HydraMigrate.bs.js').migrate().then(() => { console.log('finished setting up table'); process.exit(0)}).catch((e) => { console.error('there was an error', e); process.exit(1); })")

export NODE_OPTIONS=--max-old-space-size=800 # conservative here, can be increased if needed
echo "starting indexer..."
pnpm envio start
