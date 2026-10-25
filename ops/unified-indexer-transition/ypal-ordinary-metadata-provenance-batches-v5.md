# Ordinary V5 metadata provenance batches

This is a finite executor for the already acknowledged native metadata owner.
It does not select or restart workers, change source routes, approve metadata,
grant roles, delete unmatched publications, or issue signer transactions.
Production execution and throughput remain unqualified until the actual input,
selected worker and authority are checked on the host.

The runner pins the unchanged `9b9184e6` owner, `dc0e4a9b` context and `730d678a`
same-actor source authority. It constructs one genuine metadata Host with the
original metadata execution context. Each original refresh calls the new live
`metadata_refresh`; the expensive genuine full 5a preflight and postflight run
once per invocation. No ready lease or cached current-source proof is used.

This is the baseline READ143 plus V5b71 phase. Run before cache4/LOGIN changes.
The authority is explicitly active paid ordinary standalone only. An inverse,
managed writer, source restart, changed financial authority or later READ graph
needs its own reviewed composition. No production 15/90-second held-child
callback qualification is inferred from this independent workload.

## Protected input and review

The fixed root-owned mode0600 input is:

`/var/backups/yunipals-ypal-ordinary-metadata-provenance-input-v5-20261025/input.json`

It has exactly these keys:

| Key | Value |
| --- | --- |
| `format` | `yunipals-ypal-ordinary-metadata-provenance-batches-v5-input` |
| `metadataInputSha256` | Actual original execution input `bc618a85…` pinned by the runner |
| `metadataOperationSha256` | Actual operation `8aa248a2…` pinned by the runner |
| `selectedReceiptSha256` | SHA256 of the actual original `selected.json`; mandatory, no default |
| `selectionCompletionSha256` | SHA256 of the actual new9a completion `result.json`; mandatory, no old failed-select success claim |
| `firstIndex` | First unused original provenance index, 0–127 |
| `maxBatches` | Positive count ending at or before original index127 |
| `maxSeconds` | Dispatch window, 720–3600 seconds |

The actual ordinary source result/input, READ refs, candidate inputs and source
manifest come from that original authenticated metadata execution input. They
are not replaced with new operation ancestry. The runner authenticates the
actual operation, adoption, native start/acceptance, selected actor and boot
publication journals, then compares the live exact selected actor and boot.
The new9a completion result must bind the same selected receipt and own start
intent; its recorded actor, when present, is checked too. Observation-only
lost-start-ACK completion remains valid without that optional own actor file.
The original9b failed-select CLI is never reclassified as successful.
Any metadata inverse prefix refuses dispatch.

Default invocation is inert. With the real protected input hash, the command
below performs a read-only review under the original metadata transition flock:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-metadata-provenance-batches-v5.py --input-sha ACTUAL_INPUT_SHA
```

Keep its detailed binding host-private. Use its exact `reviewSha256` and a fresh
run name only after reviewing the actual facts:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-metadata-provenance-batches-v5.py --input-sha ACTUAL_INPUT_SHA --apply ACTUAL_REVIEW_SHA --run-id UNIQUE_NAME
```

The runner creates an exclusive0700 run directory beneath
`/var/backups/yunipals-ypal-ordinary-metadata-provenance-batches-v5-20261025`.
Its durable0600 intent precedes dispatch. CLI output is only aggregate counts,
stop reason and result hash. Actor/configuration observations stay private.
The unchanged official command may make its genuine canonical RPC checks and
write provenance metadata; the runner does not claim zero database/provider
effects for those calls.

## Dispatch and reconciliation

Each dispatch calls exactly the original `n.provenance(h, op, index)`, including
the official native-refresh/canonical point checks, 5,000-row limit, exclusive
intent/child/result/observed files, 660-second child wait and original complete
publication proof. There is no worker-manager entrypoint in this runner.

All earlier indices need matching genuine intent/result/observed receipts.
Any file prefix for a requested index refuses execution, including an incomplete
or unrecognized prefix. The runner never reconciles, adopts or resends it.
If an effect finishes but a later authority check fails, the original receipt
remains genuine and the runner fails; it does not invent its own success.

The loop stops on busy, zero progress, genuine full publication completion,
the finite count or insufficient remaining time. Each new dispatch reserves
720 seconds for the unchanged child and ownership checks, checked again after
fresh prechecks. A separate 5,400-second invocation alarm bounds pathological
observation delays. An interrupted or timed-out child remains an unknown
outcome with original files requiring explicit reconciliation, never a retry.
Errors are not retried. A final full source postflight is required before the
runner writes `result.json`; failed postflight leaves `failed.json` instead.

Native canonical-event index OID77273352 on relation75963666 was actually
observed valid/ready/live by root. The runner independently checks those OIDs,
database17584, exact btree expression/order/predicate and flags before and after
the workload. Missing or changed index refuses execution; it performs no DDL.
Index presence is not a claim about the planner or measured throughput.

## Local verification

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-metadata-provenance-batches-v5.test.py
```

Twenty-three controls execute the genuine provenance body with synthetic live facts,
the genuine constructor signature and real exclusive filesystem journals.
They cover limits, selection/adoption/boot ancestry, installed-index refusal,
contiguous dispatch, busy/zero/complete stops, unknown outcomes, actor/source
changes, postflight failure and deadline reservation. These are source-only
controls, not production SQL or throughput results. The original official SQL
and canonical/unmatched-row semantics remain unchanged.
