# Managed source after the retained-prefix observer replacement

These successors change the observer producer binding and their own operation
namespaces. The existing four files under `OPS/ypal-ordinary-managed-indexer-v1`
stay byte-for-byte unchanged. Source code, native schema/cache, financial
policy, permits, private environment order, six mounts, Solana configuration,
reader authority and lifecycle algorithms are unchanged.

The new foundation is `ypal-ordinary-managed-runtime-v2.py`; it requires the
actual receipt from `ypal-ordinary-observer-retained-prefix-v1.py`. The old
observer receipt remains that operation's recorded predecessor. It is not
accepted as the new observer activation.

## Actual input and operation namespaces

Create a protected, exclusive input at
`/var/backups/yunipals-ordinary-managed-runtime-input-v2-20261025/input.json`
only after the observer replacement has its actual acknowledged receipt. The
exact fields are `format`, `ordinaryResultSha256`, `ordinaryInputSha256`,
`solanaAuthSha256` and `observerResultSha256`. Format is
`yunipals-ordinary-managed-runtime-v2-input`; every hash must authenticate an
existing receipt or input. No future receipt hash is defined by this package.

The foundation's observations live in
`/var/backups/yunipals-ordinary-managed-runtime-v2-20261025`.
The lifecycle successor is `ypal-ordinary-managed-handover-v2.py`, with its own
`/var/backups/yunipals-ordinary-managed-handover-v2-20261025` journals and
`/etc/systemd/system/.ordinary-managed-handover-v2` held original inodes.
The earlier v1 namespaces and receipts are preserved.

Use the explicit phases and inverse described in
[the original lifecycle runbook](ypal-ordinary-managed-handover-v1.md), invoking
the **v2** lifecycle and passing the **v2** input hash. Its review, drain,
install, one start, lost-acknowledgement observation, finish, current and
inverse functions are identical to the reviewed v1 functions. The observer
is independently qualified but is never stopped or started by this lifecycle.
Complete any one-shot consumer operation still bound to the standalone source
before draining that source. A managed writer receipt does not itself qualify
readers, canonical coverage, or scheduled Solana publication.

## Recurring source leaf

`ypal-ordinary-recurring-source-v5b.py` binds the new lifecycle and foundation.
Its API remains `validate_source_phase(refs, inverse=False)`, with exactly
`lifecycleResultSha256`, `foundationInputSha256` and `readviewCreatedSha256`.
Those are actual receipts from the new lifecycle/foundation and the existing
V5 read-view creator. An active managed writer must be framework-ready for a
forward recurring cycle. The terminal branch remains inverse-only, with
unchanged process-epoch, native data and kernel-session proofs. This leaf
does not install or start a recurring worker, publish a generation, grant
permissions or substitute for completed metadata/cache/reader acceptance.

## Local validation

Run the new `ypal-ordinary-managed-runtime-v2.test.py` (17 controls),
`ypal-ordinary-managed-handover-v2.test.py` (29),
`ypal-ordinary-recurring-source-v5b.test.py` (10), and
`ypal-observer-managed-successors-v2.test.py` (4) with `python3 -I -B`.
The last suite authenticates the frozen predecessors and compares the complete
new source after only the listed producer/path/version substitutions. It also
checks the unchanged four runtime files and the genuine new observer API.
No production actions or current-runtime acceptance are claimed by these tests.
