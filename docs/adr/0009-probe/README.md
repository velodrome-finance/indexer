# Per-chain mechanics probe (ADR 0009)

A minimal envio 3.16.0 project (WETH transfers on Mode, Soneium, Unichain;
`config.5chains.yaml` adds Lisk and Ink) used to answer the mechanics questions
in ADR 0009. Copied from `research/hyperindex-upstream/repros/minimal`; not part
of the indexer.

    npm i envio@3.16.0 vitest@4.1.0 typescript   # or copy node_modules from the repro
    npx envio codegen && npx vitest run          # createTestIndexer semantics
    ./run.sh run1.log                            # 3 chains, 3 workers (scratch stack, db velo_pc_min)
    # add a chain: append it to config.yaml, then
    ./run.sh run2.log --chain <id>               # a plain start is refused (chains.<id>)

`run.sh` reads the dev box's scratch-stack secrets; the effect log
(`effect-calls.log`) records every real call of the shared `hourTag` effect
with the worker pid.
