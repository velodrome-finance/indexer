"""Rewrite config.yaml in place as an Aero-only config for testing (never merge the result).

Keeps the seven Aero chains and drops every other chain. On the chains that
also carry legacy contracts (Optimism, Base, Ink) it starts at the Aero launch
block and keeps only the Aero contracts plus the shared dynamic Pool / CLPool,
V2CustomFeeModule and DynamicSwapFeeHook. The Aero-only chains are unchanged.

Usage: python3 -I aero_only_config.py <config.yaml> [end_block]
"""

import re
import sys

AERO_START = {10: 158475795, 8453: 52880042, 57073: 59052441}  # src/Constants.ts aero.startBlock
AERO_CHAINS = {10, 8453, 57073, 1, 42161, 4663, 5042}
KEEP = {"Pool", "CLPool", "V2CustomFeeModule", "DynamicSwapFeeHook"}

path = sys.argv[1]
end_block = sys.argv[2] if len(sys.argv) > 2 else None

with open(path) as fh:
    lines = fh.read().split("\n")

out = []
in_chains = False
chain = None
skipping_contract = False
for line in lines:
    if line.startswith("chains:"):
        in_chains = True
        out.append(line)
        continue
    m = re.match(r"^  - id:\s*(\d+)", line)
    if in_chains and m:
        chain = int(m.group(1))
        skipping_contract = False
    if not in_chains or chain is None:
        out.append(line)
        continue
    if chain not in AERO_CHAINS:
        continue
    if re.match(r"^    (start_block|end_block):", line):
        if line.lstrip().startswith("end_block"):
            continue  # replaced below
        start = AERO_START.get(chain)
        if start is not None:
            out.append(f"    start_block: {start} # Aero-only test config")
        else:
            out.append(line)
        if end_block:
            out.append(f"    end_block: {end_block}")
        continue
    if chain in AERO_START:
        n = re.match(r"^      - name:\s*(\S+)", line)
        if n:
            name = n.group(1)
            skipping_contract = not (name.startswith("Aero") or name in KEEP)
        if skipping_contract and line.startswith("      "):
            continue
    out.append(line)

with open(path, "w") as fh:
    fh.write("\n".join(out))
