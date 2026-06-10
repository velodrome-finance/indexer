# Data-integrity audits

Per-deployment integrity reports produced by `scripts/integrity-audit.ts`. See
that script's header comment for the field-level invariants and findings
model.

## Running an audit

```bash
OLD_GRAPHQL_URL=https://indexer.us.hyperindex.xyz/<old-slug>/v1/graphql \
NEW_GRAPHQL_URL=https://indexer.us.hyperindex.xyz/<new-slug>/v1/graphql \
pnpm dlx tsx scripts/integrity-audit.ts > docs/audits/$(date +%F)-integrity-vs-<old-commit>.md
```

The script reads RPC URLs from `.env` (`ENVIO_*_RPC_URL`). Chains with no
configured RPC silently skip on-chain checks; GraphQL checks still run.

## Findings model

Each finding is classified into one of four buckets so expected behaviour
changes don't drown out real regressions:

| classification     | meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `NEW_REGRESSION`   | Correct on OLD, wrong/missing on NEW. Blocker.           |
| `EXPECTED_FIX`     | Wrong on OLD, correct on NEW per a listed issue.         |
| `EXPECTED_MIGRATION` | Value shape changed by design (e.g. #812 fee rescaling). |
| `OPEN_GAP`         | Wrong on both (e.g. #707 SuperSwap, #738 188-pool $0).   |

The report groups by classification → flag → chain so the
`NEW_REGRESSION` section reads top-down as a punch list.
