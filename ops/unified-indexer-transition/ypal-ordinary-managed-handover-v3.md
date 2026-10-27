# Managed handover after actual V5 feature retirement

This successor closes the initial handover's temporary-source contradiction:
the ordinary writer's default kernel check expects a live temporary YPAL
writer, while the managed handover requires that writer to be retired. The new
owner supplies the feature owner's actual completed-retirement proof to the
ordinary source validator. It retains the same positive kernel join and does
not treat an unproved empty actor set as retirement.

The fixed feature producer is `ypal-ordinary-feature-handover-v5.py` at
`cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880`.
Its `validate_feature_leaf()` authenticates completed consumer/retirement
facts without claiming the current indexing writer. Its separate
`Host.retained_current()` proves the actual stop intent, gone original process
epochs and terminal temporary writer. Both checks are repeated around capture;
an API replacement, feature inverse or changed stop proof refuses.

## Inputs and sequencing

First complete the existing V5 feature switch and its genuine event-qualified
temporary-source retirement. No future receipt value is supplied here. Preserve
the existing foundation v2 input and its actual retained-prefix observer receipt.

Create a new exclusive protected file at
`/var/backups/yunipals-ordinary-managed-feature-input-v3-20261025/input.json`.
Its exact fields are:

- `format`: `yunipals-ordinary-managed-handover-v3-feature-input`.
- `foundationInputSha256`: the actual managed foundation v2 input hash.
- `feature`: exactly `retirementSha256`, `manifestSha256`, `inputSha256`, each
  referencing the completed fixed V5 feature operation.

Keep this input and detailed receipts private. Supply its actual hash as
`--feature-input-sha`, together with `--input-sha` for the foundation input.
Every lifecycle envelope binds both. The foundation remains
`ypal-ordinary-managed-runtime-v2.py` at
`1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199`;
the four previously staged managed runtime files stay unchanged.

Use the existing bounded phases and inverse in
[the lifecycle runbook](ypal-ordinary-managed-handover-v1.md), invoking
`ypal-ordinary-managed-handover-v3.py` with both hashes for every phase.
The new journals are
`/var/backups/yunipals-ordinary-managed-handover-v3-20261025`; original held
inodes are stored in `/etc/systemd/system/.ordinary-managed-handover-v3`.
No old v1/v2 operation directory is reused.

The retained feature API, selected definitions, private inputs, queue schedule,
owned temporary-source retirement and actual serving-peer frame must remain
unchanged throughout handover and its inverse. Only the standalone EVM and
legacy Solana actors are drained; the observer and consumers remain active.
Financial policy, proxy permits, source data, schema/cache and all lifecycle
stop/start/install/rollback algorithms are unchanged. An unknown service
acknowledgement still uses the original observation-only finish path.

## Source API

The new lifecycle exports
`validate_current_source(receipt_sha, input_sha, feature_input_sha)` and
`validate_restored_source(receipt_sha, input_sha, feature_input_sha)`.
`input_sha` remains the foundation input hash; the additional argument is not
an alias for it. Current managed output includes `featureInputSha256`.

`ypal-ordinary-recurring-source-v5c.py` accepts the same source-phase API as the
earlier leaf, with one additional mandatory ref: `featureInputSha256`. Its four
refs are `lifecycleResultSha256`, `foundationInputSha256`,
`featureInputSha256` and `readviewCreatedSha256`. It authenticates both input
hashes against the actual lifecycle acknowledgement. V5 data/marker checks,
framework-ready forward qualification, and exact terminal inverse-only
semantics remain unchanged.

This initial source leaf deliberately refuses after a later feature inverse
changes those retained actors. A named recurring forward factory requires a
separate explicitly authenticated phase composition; it cannot reuse this
initial feature-retirement proof as current after restoration.

## Validation

Run both new `.test.py` files with `python3 -I -B`. The lifecycle has 35 controls,
including all 29 prior lifecycle controls, genuine frozen kernel mapping with
the new retirement callback, refusal of the old live-temporary-source path,
receipt/actor races and exact AST equality of unchanged effect/inverse bodies.
The source leaf has 12 controls, including actual constructor argument binding
and rejection of missing or foreign feature input references. These are local
proofs, not production handover acceptance.
