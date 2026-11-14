#!/usr/bin/env bash
# Runs every Aero check against one (stopped) instance, one pass per chain,
# and writes one markdown file per check into OUT_DIR.
#
# Usage: scripts/verify/aero/run_all.sh <instance> <out_dir> [chain ...]
# Default chains: the seven Aero chains. Base also gets verify_root and
# every run ends with verify_crosschain.
set -uo pipefail
INST="$1"
OUT="$2"
shift 2
CHAINS=("$@")
[ ${#CHAINS[@]} -eq 0 ] && CHAINS=(8453 10 1 42161 57073 4663 5042)
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
for c in "${CHAINS[@]}"; do
  for check in verify_leaf verify_logs verify_swaps; do
    echo "$(date -u +%T) $check $c"
    node "$DIR/$check.mjs" "$INST" "$c" > "$OUT/$check-$c.md" 2> "$OUT/$check-$c.err" || echo "  FAILED (see $OUT/$check-$c.err)"
  done
done
echo "$(date -u +%T) verify_root"
node "$DIR/verify_root.mjs" "$INST" > "$OUT/verify_root.md" 2> "$OUT/verify_root.err" || echo "  FAILED (see $OUT/verify_root.err)"
echo "$(date -u +%T) verify_crosschain"
node "$DIR/verify_crosschain.mjs" "$INST" > "$OUT/verify_crosschain.md" 2> "$OUT/verify_crosschain.err" || echo "  FAILED (see $OUT/verify_crosschain.err)"
echo "$(date -u +%T) done"
