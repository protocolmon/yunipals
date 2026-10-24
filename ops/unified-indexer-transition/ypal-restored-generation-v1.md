# Restored-source unpublished generation preparation

This new producer prepares and validates an unpublished native generation using the reviewed installed generation artifact. It never relabels the historical generation, publishes the global pointer, changes leaderboard rows/stamps, grants access, or starts a source scanner. The previous generation owner and capacity monitor remain unchanged.

The new owner uses `yunipals-ypal-restored-generation-v1` and `/var/backups/yunipals-ypal-restored-generation-v1-20261024`. Its one-shot unit, runtime directory and PostgreSQL application name have distinct restored-generation identities. The existing transition lock path is retained for mutual exclusion with coordinated publication. The installed artifact, official preparation command, existing selector candidate, pool limit, capacity estimates, reserves, backup exclusion, cancellation SQL and recovery capsule component remain unchanged.

## Actual constructor and acknowledgement prerequisites

The owner loads the new restored metadata producer, not a historical metadata Host. An actual `--metadata-input-sha` selects that producer's fixed root-private input, exact reviewed provider sources and new READ admission/plan/context references. Its default callback checks current source and exact permission scope. `--read-ack` must equal the actual metadata context admission. All metadata operation, selected actor and completed provenance receipts must belong to the new metadata operation directory.

The new operation and candidate record the complete normalized READ config, metadata input SHA, actual new metadata producer SHA and historical generation-source ancestry. Future references are not supplied by this preparation. Actual READ approval/commit, native metadata handover, full published Base provenance, four canonical ownership sources, installed runtime and capacity must all be qualified before an effect is eligible.

The constructor and logical database leaf remain distinct. `validate_candidate_database_current(candidate_sha)` uses the static restored metadata query context. It does not call an obsolete source whole validator or require the original process PID to remain alive. It reauthenticates the immutable candidate/operation/capsule and actual unpublished generation row, full validation/source snapshot, predecessor and unchanged global pointer/stamp/wallet aggregates. It returns `sourceReadinessQualified`, `metadataCurrentReadinessQualified`, `readAdmissionGraphQualified` and `cacheActorQualified` as false. Its caller must separately qualify the current source phase, native/canonical readiness and acknowledged graph extensions. Static construction is still tied to its explicitly authenticated receipt ancestry; it does not authorize a new source epoch or server boot.

## Read-only default and explicit effects

The no-argument invocation is static, with no host, database, provider or application startup:

```sh
python3 ops/unified-indexer-transition/ypal-restored-generation-v1.py
```

A real read-only review requires actual `--metadata-input-sha`, `--read-ack`, `--install-ack`, `--metadata-operation`, `--metadata-selected`, `--metadata-provenance` and `--metadata-provenance-sha`. The provenance filename is a bounded owned batch observation. Review output and later actual receipts stay private on the host.

The same accepted phase sequence remains:

1. Review and `--phase drain --ack REVIEW_SHA`: verify the exact legacy leaderboard writer, sole original activation and current consumer/private configuration; capture its kernel-owned backend subset immediately before the owned stop intent; move only the original boot inode and prove the captured writer/backend subset terminal.
2. `--phase capsule --ack OPERATION_SHA`: capture the original global pointer/predecessor, complete wallet statistics, both derived stamps, archive and generation bindings in the existing private database-local recovery capsule. The component requires its fixed capsule schema to be absent. It never adopts an earlier capsule. Root fsyncs the prepared acknowledgement before authorizing the sole commit. No row payload leaves the database.
3. `--phase build --ack OPERATION_SHA`: recheck metadata/source/graph, all four ownership sources, legacy consumers, exact capsule and capacity. Invoke the reviewed preparation artifact once under the new unenabled one-shot unit. The official artifact builds and validates only an unpublished candidate. Its pool limit is still four, storage reserve 25 GB and abort threshold 30 GB; no backup may overlap the bounded window. Actual available capacity must fit the measured capsule/snapshot/generation peak. A successful inactive install is not a capacity waiver.
4. `--phase accept-candidate --ack OPERATION_SHA`: require the exact successful worker invocation and terminal cgroup/backends, bounded private output, actual candidate start time, ready/unpublished native row, exact validation/source identity, predecessor and unchanged global state. It writes only the new protected candidate receipt.

`reconcile-capsule` and `reconcile-build` inspect their owned unknown acknowledgement prefixes and never repeat a SQL build, capsule capture or manager start. A start intent blocks a second build. The capacity monitor changes only its unit/runtime/application/public-env identities; all executable function bodies and cancellation predicates match the reviewed monitor.

Consumer fencing uses the unchanged pure consumer-frame observer with an explicit bounded SDK command/protected-file facade. It never passes the retained worker helper into an incompatible timeout signature or invokes its historical source constructor.

## Receipt contract

The fixed accepted path is `/var/backups/yunipals-ypal-restored-generation-v1-20261024/candidate-result.json`, with format `yunipals-ypal-restored-generation-candidate-v1`.

Existing semantic fields are retained: `completed`, `built`, `validated`, `published:false`, `publicationAllowed:false`, `operatorSha256`, `operationSha256`, `readAdmissionSha256`, metadata operation/selection/provenance references, candidate selectors/install/artifact references, actual generation ID, source release/read identity/archive, predecessor, complete validation hash/source snapshot, capsule result hash and original global aggregate observation. Added fields explicitly bind `readConfig`, `metadataInputSha256`, `metadataOperatorSha256` and `historicalGenerationProducerSha256`. No future generation ID or acknowledgement is predicted.

The operation format is `yunipals-ypal-restored-generation-v1`. `operation.json`, `capsule-result.json`, `candidate-result.json` and `activation-restored.json` all belong to the new directory. The recovery capsule retains its unchanged component format and database-local schema; its owned external binding and new operation chain distinguish this capture. Both generation rows remain intact.

The cache/provider and coordinated publisher must pin this new producer/path/format explicitly. A previous generation-owner receipt does not satisfy it. The candidate database leaf alone does not authorize cache grants, canonical acceptance, reader switches or publication.

## Restore and publication boundary

`restore-activation` / `reconcile-start` require the competing candidate worker to be terminal, the original global pointer/stamps/wallets unchanged, consumers unchanged or separately pre-inversed, and an accepted metadata inverse under the new metadata producer. They restore only the preserved legacy activation. An already-issued original start is reconciled without a second start.

There is no generic publish, leaderboard mutation or derived-state inverse phase in this owner. A separate coordinated publisher must consume the actual unpublished candidate and guard preparation, stage leaderboard rows privately, perform the guarded atomic global commit, and own reader availability/recovery. Any later capsule restore must use that caller's exact owned publication/current-pointer and pre-inversed consumer/guard proof. Merely possessing this capsule is insufficient. Recurring generation/leaderboard lineage and normal managed source restart acceptance are separate goal requirements.

## Verification

```sh
python3 ops/unified-indexer-transition/ypal-restored-generation-v1.test.py
```

Twenty local controls cover the retained filesystem/lifecycle and candidate/global-state guards plus new constructor direction/reference checks, static default, exact new labels, the actual reused consumer-frame timeout interface, and AST equality. The capacity monitor changes only four identity constants. Among existing owner methods/functions, the audited seams are `Host.__init__`, `Host.consumers`, `review`, `operation`, `worker_terminal`, `unit_bytes`, `accept_candidate`, `validate_candidate_database_current` and `main`. Capsule bridge SQL, generation business checks, capacity formulas, owned cancellation and restoration bodies stay unchanged. No new application artifact, permission edge, provider request, host query or production action was performed in this preparation.
