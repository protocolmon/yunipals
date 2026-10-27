# Recent completed pack openings API

Prepared only. The endpoint is `GET /v1/boosters/recent-openings?limit=12` (limit1–24), with the existing deployment snapshot and `items: BoosterRecentOpening[]`. Each item contains `requestKey`, `requestId`, `engine`, `opening`, `quantity`, `revealedAt` (completion Unix seconds string), and a `monster` cover. An empty history is `items:[]`.

The query orders actual `RequestCompleted` journal block/log positions descending. A purchase is one item; a saved daily batch is also one item. All minted NFTs must account for the entire request, match its original/type/rule/recipient, and have exactly one verified `MonsterMinted` witness in the completion transaction before the completion log. The cover is the first mint log, irrespective of reserved numeric NFT IDs. Quantity follows the registered type's `maxBatch` and the registry's32 bound; the current UI seven-card claim limit is independent. Burned/transferred historical covers remain visible, retaining their actual `mintedTo`. Pending, forfeited, partial, foreign, future and ambiguous requests are omitted. Selected malformed provenance returns no-store503. One SQL statement supplies the data snapshot; all witnesses must be within the proven ready prefix. No RPC, generation or SQL write is performed.

The default build directory remains the historical b624 artifact. Reproduce the separate candidate with:

```sh
cd /root/yunipals/apps/yunipals-indexer
node scripts/build-booster-api.mjs --outdir artifacts/booster-recent-openings-api-v1
```

The candidate is `41fe9b9cb87edaa5689ed611cd2c99b299215be7c8fb6262b560660854657c73` (54579bytes); manifest `f7657a2bf0eaf13048fc86db67a65f8e203bbb8d7fefcf4be4384444a99c917a`. The included queue artifact remains the exact existing `e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33`; its service/timer and program selection are unchanged.

126 focused related API tests pass, including37 new real PostgreSQL-compatible PGlite SQL controls. The exact built HTTP entrypoint also passed against the existing disposable PostgreSQL16.15 fixture with a SELECT-only ten-table role.22 real-file operator controls cover CAS, retained configuration, owned inverse and lost manager acknowledgement. Indexer TypeScript passes. The exact final query additionally passed on the actual host as existing UID967/GID961 collector, using Unix peer auth in a repeatable-read/read-only transaction,5s statement timeout and no provider calls. Only counts, public snapshot fields and hashes were transferred; see the preparation proof.

## Reviewed HTTP-only operation

Stage the flat public input archive in a new protected root-owned directory, for example `/var/backups/yunipals-booster-recent-openings-input-v1-20261023`. Do not overwrite any prior input/release/evidence. It contains the three pinned artifacts and the new operator. This preparation has not staged or started anything on production.

On `yunipals-main`, review without writes:

```sh
python3 -I -B /var/backups/yunipals-booster-recent-openings-input-v1-20261023/rollout-recent-openings-api-v1.py
```

The review requires the actual acknowledged b624/b160 prior rollout and exact current HTTP actor1700549/inv837b70e85e85443991a2b69a2d58a06f. It captures both current source actors, all four RPC proxy actors/definition hashes and the exact artwork queue definitions/program. The periodically running queue service is not required to retain a single invocation. Existing global, request-monsters, NFT birth and approved-art responses must pass; the old recent route must be404. A stale current actor or drift requires fresh investigation, never an invented review hash.

After reviewing the actual result, an explicit command with that fresh returned hash is the only apply path:

```sh
python3 -I -B /var/backups/yunipals-booster-recent-openings-input-v1-20261023/rollout-recent-openings-api-v1.py --apply ACTUAL_REVIEW_HASH
```

This creates one immutable API release, copies the three pinned files, reuses the existing dependency tree, atomically replaces only the two existing API release-path occurrences in the exact unit, daemon-reloads and restarts only `yunipals-booster-api.service`. The original unit, private `EnvironmentFile` reference, public catalog configuration, both indexers, all proxies, artwork queue, schema and ACLs are preserved. New recent/global/request/birth/art checks must pass before an owned success receipt is written. New history is validated from its own checkpoint to allow genuine events arriving during the probes.

Evidence: `/var/backups/yunipals-booster-recent-openings-api-v1-20261023/`. A lost acknowledgement is not retried automatically. Use `--inspect` to reconcile only the start within the owned recorded monotonic window, or explicit `--rollback ACTUAL_OPERATION_SHA256` to restore the exact original HTTP unit and restart only that service if necessary. Failed/unknown inverse acknowledgements require inspection; do not rerun an existing inverse intent blindly. All historical releases/evidence remain. There is no contract, source/indexer restart, grant, schema, queue, provider-budget or wallet operation here.

The current-feature7fc entry / v6 handover remain historically pinned to b624/b160. After any actual new rollout, a new explicit API-binding/handover successor must acknowledge its real receipt before full unified migration. Do not rewrite or claim that the old current-feature validator passes this new runtime.
