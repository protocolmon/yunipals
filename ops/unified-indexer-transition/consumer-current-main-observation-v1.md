# Current main reader restart qualification

`consumer-current-main-observation-v1.py` is a new, bounded observation helper.
It leaves the existing selector record, e283 consumer entry, install7, v7 booster
handover and final-v4 supervisor unchanged. It runs no database query, provider
request, service action, runtime selection or role/grant operation.

The original selector record has SHA
`3a031e154a911b7b38634518cf872d5b224602cf393e174fb12cd7c5c2d641eb`
and identifies main invocation `61a721b3e677483a9dd4c273decbdee3`.
Actual main invocation `29aaa668db3d4e0cb9ebdddf851324d6` was qualified against
the accepted static/runtime baseline `caa2626c651d29e9a2bdb15e16be2e390d39b6c96ba27a6976cd921f991d2717`.
The helper explicitly records that the old stored-invocation check does not pass.
Collector and Islands must still match their complete original observations.

The helper reuses the pinned public static/runtime verifier and selector
observer. It requires the accepted main command, working directory, definitions,
private-setting fingerprint and public runtime bytes. It additionally hashes
every current ordered private file, compares every configured value and known
source selector with the real process internally, and repeats code, file and
identity checks before returning. Private values are never returned. A restart,
input change or different peer invalidates a saved acknowledgement.

The default command is side-effect-free:

```sh
python3 -I -B consumer-current-main-observation-v1.py
```

Its source was qualified on production from sealed memory only. Four historical
helper files and both baseline records exist with the exact expected hashes.
The fifth public helper, `consumer-retained-selectors-observe-v1.py`, SHA
`066c74a83a2933544b2e204c253e10756bc8cb4e8e9665e63123ddc29b273350`,
is absent from the protected operations directory. The source qualification
therefore supplied those exact observer bytes from sealed memory and explicitly
reports `defaultInstalledEntryQualified:false`. Staging this one unchanged public
dependency and the new helper is required before a real installed invocation.
No protected acknowledgement has been written.

After source review/staging, the explicit acknowledgement command is:

```sh
python3 -I -B consumer-current-main-observation-v1.py --acknowledge <fresh-review-hash> --run-id <fresh-bounded-run-id>
```

It captures again and requires the identical review hash. It exclusively creates
`/var/backups/yunipals-current-main-reader-observation-v1-20261023/<run-id>/result.json`.
Existing or partial run directories are never overwritten. Each subsequent
legitimate restart requires a new observation and fresh run ID. The old receipt
remains intact. `validate_current(path,pin)` requires the exact protected file and
repeats current qualification. `qualify_scope(scope,path,pin)` returns a deep copy
with the fresh retained selector DTO and an explicit acknowledgement reference;
it accepts only the unchanged original scope and never edits the old record.

This helper alone does not change the executable consumer composition. The
smallest subsequent entry must wrap the current e283 entry's **outer**
`owner`, `preview` and `install` module results and bind this acknowledgement in
their reviews/results. Before replacement, use fresh qualification for legacy
peers. After a peer has been replaced, require the existing install7
`installed_other` and `verify_installed` proofs for that exact new-entry producer,
artifact, invocation, definitions, private inputs and saved acknowledgement;
continue freshly qualifying every remaining legacy peer. A non-original PID,
LOGIN bit or saved hash alone cannot authorize that branch. Requiring the old
legacy process after its acknowledged replacement would create a lifecycle
dead end. No such successor entry or downstream pin change is included here;
root will scope that closure separately.

All native source/witness, metadata adoption, generation identity, cache guard,
preview and final admission gates remain in force. Current readiness is not
qualified by this helper. The fresh prerequisite observation still has no native
chain witnesses/metadata approval, generation 103 lacks the v4 identity, and the
35 cache mappings contain no native-source edges. Existing commands remain:
the corrected v4 `native-recovery.sh native-adopt`, bounded provenance/refresh,
official generation readiness/refresh with capacity monitor, coordinated native
guard transition, then cache/main/collector/Islands admission. Their original
writers must be drained at the appropriate owned transition.

Local verification is deterministic and offline:

```sh
python3 -I -B ops/unified-indexer-transition/consumer-current-main-observation-v1-test.py
```

Seventeen controls cover real reused runtime/definition/private-setting checks,
private-file/process mismatch, injected source selectors, repeated-read races,
peer changes, immutable scope/receipts, changed acknowledgements and unsafe file
types. The accompanying qualification evidence distinguishes source execution
from installed execution and from a future saved acknowledgement.
