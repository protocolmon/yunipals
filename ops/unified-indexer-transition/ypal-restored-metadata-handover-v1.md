# Restored-source native metadata handover

This is a new producer for a future metadata operation. It does not reuse the old metadata operation identity, claim the old source actor is current, or create a permission acknowledgement. The historical metadata owner and candidate producer stay unchanged.

The new owner uses `yunipals-ypal-restored-metadata-handover-v1` and an exclusive `/var/backups/yunipals-ypal-restored-metadata-handover-v1-20261024` operation directory. Its native overlay has a distinct `ypal-restored-native-metadata.conf` suffix. The existing metadata unit, official advisory lock, installed worker, private environment, six public selector changes and operational SQL remain the accepted implementations. No source service, provider policy, grant, key or publication journal is changed by preparing these files.

## Constructor boundaries

`ypal-restored-metadata-context-v1.py` exports three deliberately different interfaces:

- `query_components()`, `load_static_components()`, `query_host()` and `reader_host_static()` authenticate the actual restore receipt, its static constructor chain, the historical READ scope, and native object identity. These perform bounded owner READ ONLY queries. They do not require an active source and do not qualify a source actor, permissions or coverage. This allows inverse and later consumer constructors to exist before their explicit phase guard runs.
- `metadata_primitives()` adds the exact installed metadata artifact, retained worker helpers and immutable read-view/candidate ancestry. It never invokes the old candidate `load()` or source whole validator. The resulting named mapping is not an old constructor tuple.
- `inverse_source()` / `validate_inverse_runtime()` / `source_inverse_context()` separately check the acknowledged restored source active epoch or its terminal state. They retain exact original loaded definitions, six mounts, boot inode, private inputs, independent nine-proxy proof and native safe/finalized floors. A terminal source must have an empty cgroup and the acknowledged PID epochs must be gone. This does not prove writer exclusivity or attribute all shared-role sessions; the transition caller owns those additional checks.

Forward source qualification remains the frozen restored READ/source context. A static query object does not substitute for it. No terminal branch calls an active validator and then labels its failure as success.

`construct_context(config, refresh_callback, inverse=False, primitives=None, admission_ref=None)` creates the new metadata Host. `config` is exactly:

```json
{
  "admissionSha256": "actual new READ143 acknowledgement SHA",
  "readPlanSha256": "actual new plan SHA",
  "readContextInputSha256": "actual new restored READ context input SHA"
}
```

Every value must be a 64-character lowercase SHA256. The explicit `admission_ref` contains `producerFile`, `producerSha256`, `resultFile`, `receiptSha256`, `planSha256` and `contextInputSha256`. Producer and result paths are fixed to the NEW restored READ admission. Its actual result must authenticate the new producer, boot, plan, context input and reviewed/rehearsed/commit record chain. A historical admission is rejected.

The mandatory zero-effect refresh callback returns `validated: true`, the exact `readAdmissionSha256`, `readPlanSha256`, `readContextInputSha256`, `originalWholeValidatorPassed: false`, and zero `databaseWrites`, `serviceActions`, `providerCalls`. The default executable callback comes from the separately reviewed restored READ/cache provider and verifies current source plus the acknowledged READ graph. Later cache/reader phases supply their own explicit acknowledged READ143, four-read and LOGIN composition. This owner does not infer those extensions or claim source authority from a callback-free constructor.

For reader composition:

- `metadata(phase, candidate, selection, refresh)` accepts `phase.metadata_primitives()` with its authenticated new `readConfig` and `admission_ref`. The candidate must link the actual NEW metadata operation. It checks the exact selected actor/boot, current native scan, zero remaining published provenance and official canonical publication proof, then repeats actor/boot checks. Its result explicitly does not grant source authority or claim a historical metadata operation.
- `metadata_inverse_context(phase, candidate, refresh)` returns `(newOwner, currentHost, authenticatedOperation)`. The callback must be the caller's inverse scope. The unchanged operational inverse then runs under this new producer and operation directory. There is no callback back into metadata and no provider import in the static source leaf.

## Review and explicit phases

The no-argument command is static and makes no host, database or provider observation:

```sh
python3 ops/unified-indexer-transition/ypal-restored-metadata-context-v1.py
python3 ops/unified-indexer-transition/ypal-restored-metadata-handover-v1.py
```

Before any host phase, separately freeze and review the new permission/provider producer sources. Copy the source-manifest example to the fixed public operations path `ypal-restored-metadata-handover-v1.sources.json`, filling only their actual reviewed hashes. The example's null values are intentionally unusable. No arbitrary producer path is accepted. Stage the actual root-private input at `/var/backups/yunipals-ypal-restored-metadata-input-v1-20261024/input.json` with the manifest SHA and actual three READ references. No acknowledgement or producer SHA is predicted by this preparation.

Run the NEW owner with `--input-sha ACTUAL_INPUT_SHA` for the initial read-only review. It requires the live legacy writer, exact original activation/private configuration and actual fresh READ proof, and reports current native Base coverage of the actual legacy cursor. The drain effect remains closed unless that coverage is sufficient. The initial reviewed input and provider source manifest are bound into the operation and reauthenticated in subsequent contexts.

Each effect requires its current phase review hash as `--apply REVIEW_SHA`. The phases retain the accepted sequence:

1. `--phase drain`: captures fresh positive kernel-owned legacy backend tuples immediately before the owned stop intent, removes only the exact boot inode, stops only the captured writer and proves terminal processes plus its exact backend subset. Unrelated shared-role sessions remain.
2. `--phase adopt --operation-sha ACTUAL_OPERATION_SHA`: invokes the official `native-adopt` command once under its ordinary lock. Native frame coverage and the exact stopped cursor remain mandatory.
3. `--phase select --operation-sha ACTUAL_OPERATION_SHA`: installs the exact candidate bytes under the new owned overlay path, starts once, checks the actual native worker and restores the same original boot inode only after acceptance.
4. `--phase provenance --batch-index N --operation-sha ACTUAL_OPERATION_SHA`: attempts one bounded official batch. Prior batch observations must exist. A batch of up to 5,000 is not completion. Completion requires zero remaining archive publications and the official full canonical publication proof.

`--inspect` and `--reconcile` never repeat manager or SQL actions. Lost command acknowledgements retain their child identity and output privately. An unknown live or unidentified official command blocks mutation. Do not rerun `drain`, adoption or a start to repair an unknown result.

## Inverse and continuity

`--phase inverse` and explicit `--phase finish-inverse` retain the accepted narrow inverse: stop only the owned native worker, preserve cursor identity, use the official writer advisory lock, CAS native mode to RPC and block only the owned approval. It never deletes journals, provenance or rewinds a cursor. It restores original definitions, credentials and boot inode, then resumes the original writer only after the competing native worker is terminal.

An acknowledged original start with a lost result is reconciled without another start or SQL call. Its recorded pre-start scan may advance monotonically while fixed identity is preserved. That recovery also covers pre-adoption partial drains without a drained receipt. Unknown SQL/start/stop and unloaded reload outcomes remain explicit inspect/reconciliation boundaries; no automatic retries are added. The caller must separately own source/consumer sequencing and any required current source-terminal evidence.

Current metadata selection and provenance receipts are not supplied by this source preparation. Nothing here qualifies framework readiness, ownership parity, generation publication, reader admission, recurring refresh lineage, Arena or financial authority.

## Verification

```sh
python3 ops/unified-indexer-transition/ypal-restored-metadata-context-v1.test.py
python3 ops/unified-indexer-transition/ypal-restored-metadata-handover-v1.test.py
```

The static context has 11 focused controls. The owner has 36 controls: the 27 retained lifecycle/filesystem controls execute against the new identity, and nine added controls cover constructor separation, actual new READ chains, callback references, historical receipt refusal, default static behavior and the AST seam audit. Only `Host.__init__`, `Host.refresh`, `review`, `operation` and `main` differ among the old functions/methods. All operational/private/cursor/publication/recovery bodies and `INVERSE_JS` are unchanged. The previously reviewed real PostgreSQL inverse transaction remains byte-identical; this preparation did not run production queries or services. Detailed future receipts and observations remain root-private on the host.
