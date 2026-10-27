# Ordinary observer retained-prefix replacement

The new artifact changes only the official observer's handling of `provider_lag` and its ordinary loop diagnostic. It does not change the ingestor, native namespace, source manifest, route profile, permits, budgets, observer cadence, pool size or receipt work.

A lag cycle may retain or requalify the last successful proof only while its original timestamp and head remain fresh, its previous native witness remains on the current registered native branch, every retained anchor still has that exact control-table witness association, the native framework is ready and coverage has not regressed. Sparse native history is supported: finalized/depth anchors need not each exist in `chain_block`. The update changes only status revision, checked time and a null/`provider_lag` error. It never advances the observation timestamp, anchors, witness, head or finalized fields. Other errors and halt remain unresolved until the normal observer produces a genuine new observation. The loop reports `waiting_retained`, `reason=provider_lag` and `observationTimestampAdvanced=false`.

The source remains unavailable when the proof expires, disappears or conflicts. Retention does not manufacture current head coverage, a new RPC verification or a new canonical witness.

## Inert artifact

The deterministic builder and installer are separate from service replacement. The installer creates a new immutable artifact under the acknowledged dependency context, preserving the old artifact. Its default is read-only; the install phase creates files only. The source-only inert preparation and finite file inventory identify the exact bundle, map, manifest and compiler metadata. No service activation is included in artifact installation.

## Concrete replacement input

Stage one private input at the fixed input path declared by `ypal-ordinary-observer-retained-prefix-v1.py`, with precisely:

```json
{
  "format": "yunipals-ypal-ordinary-observer-retained-prefix-v1-input",
  "predecessorObserverSha256": "ACTUAL_PROTECTED_OLD_OBSERVER_RESULT_HASH",
  "installationReceiptSha256": "ACTUAL_NEW_ARTIFACT_INSTALL_RESULT_HASH",
  "ordinaryRuntime": {
    "resultSha256": "ACTUAL_ORDINARY_SOURCE_RESULT_HASH",
    "inputSha256": "ACTUAL_ORDINARY_SOURCE_INPUT_HASH"
  }
}
```

Placeholders are illustrative and refused by the parser. The owner authenticates the fixed old observer producer and its actual receipt, the genuine new installation, and the explicitly supplied current ordinary source. There is no guessed future acknowledgment or arbitrary entry/configuration selector.

Run with `--input-sha <actual input hash>` to capture a fresh review. It qualifies the original observer epoch, current source, unchanged registered native dataset, existing finite support privileges, fixed free-only policy lanes and new artifact. Control counters and capacity are observations; the action hash binds immutable configuration and exact actor authority. Full review data stays in the separate root-private journal.

## One replacement attempt

`--input-sha <actual input hash> --apply <fresh review hash>` fsyncs an exclusive intent, stops only the exact acknowledged observer, and confirms that epoch is gone. It keeps the original service file and boot link untouched, creates one exclusive owned entry-only drop-in, reloads the manager and starts the same service once with the new artifact. UID/GID, clean public environment, free-only routes, pool two, ordinary cadence, hardening and unlimited ordinary service lifetime are unchanged.

The full frozen loaded-definition/capability/process/cgroup checks are reused in an explicit new context. The context changes only the exact owned entry/drop and start-intent binding. It does not invoke the old owner's historical source activation hook. The original observer receipt remains historical. The new result records a new invocation and exact predecessor receipt, and separately records the source at transition.

The acknowledgment requires one actual control cycle for all four chains and a read-only native inspect. A cycle may honestly report waiting. This is observer runtime qualification, not source coverage, canonical acceptance, metadata adoption or reader publication.

## Unknown acknowledgment and inverse

Never retry `--apply` after its intent exists. A start command has the existing 135-second manager bound and one recorded start window. If its acknowledgment is lost, use `--reconcile <actual start-intent hash>` with the same input. Reconciliation observes the exact new invocation and can seal the missing result; it never reissues start or stop.

`--inverse <actual new result hash>` restores the old entry after stopping the exact new invocation. For an incomplete replacement, `--inverse <actual apply-intent hash>` supplies the operation authority. It removes only the owned drop-in and its exact empty directory, reloads, starts the old artifact once, and acknowledges that new restored epoch. It does not relabel the old observer receipt as current. An untouched original observer is instead positively observed with zero extra stop/start actions.

If inverse stop/start acknowledgment is lost, `--finish-inverse <actual inverse-intent hash>` observes the owned terminal/start evidence and completes the existing inverse without another stop or start. Foreign definitions, actor changes, active jobs, unexpected files and unproved partial filesystem ownership refuse. Preserve both the original and replacement journals; do not delete markers or retry uncertain effects.

The new producer exports `acknowledgement(receipt_sha)` for immutable ancestry and `validate_current(receipt_sha)` for the exact forward or restored epoch. The returned release ID is derived from authenticated native identity. Both keep source actor, source coverage, financial authority and whole reader graph claims separate. Current observer validation uses its own immutable inputs, registered dataset, finite role permissions and free-only policy; it does not require the former standalone writer to remain alive after a legitimate managed handover.

Consumer and managed-source constructors must bind the new producer and actual new observer receipt explicitly. Previously prepared producer hashes and the old activation receipt must not be presented as current.

## Local checks

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-observer-retained-prefix-v1.test.py
NODE_BINARY=/root/.nvm/versions/node/v24.18.1/bin/node python3 -I -B ops/unified-indexer-transition/ypal-ordinary-observer-retained-prefix-install-v1.test.py
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-ordinary-observer-retained-prefix-build-v1.test.mjs
```

From `apps/yunipals-indexer`, run Node 24 with `--import tsx scripts/test-observer-retained-prefix-postgres.mjs` against the fixed disposable local PostgreSQL fixture. The fixture executes actual native DDL, the official observer and server status, generated V5 SQL probes and a role with native SELECT-only authority. It performs no production or provider requests.
