This unselected public artifact reduces the new combined RPC proxies' budget PostgreSQL pool maximum from two connections to one. It derives from the actual installed v6 bundle with SHA256 `d8e58d18f7f88bb8b13d4f2d85d562ddd71f7ffc2c96b913410d5a656202f5c8`. The resulting 111,657-byte bundle has SHA256 `8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c`.

Only the ASCII digit in `createOpenSeaRequestBudget`'s `pg3.Pool({ … max: 2 … })` changes to `1`. The deriver requires the exact entire preimage, a single full compiled anchor, the exact output hash and identical bytes before and after that digit. Existing routes, providers, policies, budgets, credentials and role limits are untouched.

The five existing routes can use at most ten budget connections. Four new routes using this artifact can use at most four more, keeping the aggregate pool maximum at fourteen within the retained role limit of sixteen. The route owner must still freshly check actual role attributes and global database capacity before starting any route. This artifact grants no startup authority and contains no service, database, provider or policy commands.

The default command reads the fixed public installed preimage and prints its derivation proof without writing files:

```sh
node prepare.mjs
```

For an offline copy or reproducibility check, supply its exact preimage explicitly. The optional output directory must not exist; output creation is exclusive and sets public modes explicitly, including under umask 077:

```sh
node prepare.mjs --preimage /path/to/exact-public-v6.mjs --write-new /path/to/new-directory
node prepare.test.mjs
```

The test executes both exact compiled budget factories with an added test-only export, the existing real `pg.Pool`, and an offline stub client. It proves one pool is shared by all budget facades, preserves every other constructor option, and checks that a second checkout queues only for the new maximum of one. Socket, fetch and database-query guards stay at zero. It also checks reversible byte equality, foreign input refusal, explicit public modes and no-overwrite behavior.

Only a separately reviewed new route owner may select this artifact for `yunipals-combined-rpc@{ethereum,base,polygon,bnb}.service`. No production artifact or actor has been modified by this preparation. The unchanged source-map URL is retained as part of the byte-preservation invariant; this package does not claim a newly compiled source map or rebuild of the original v6 source closure.
