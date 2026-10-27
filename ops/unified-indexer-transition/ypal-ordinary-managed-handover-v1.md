# Ordinary managed writer lifecycle

This owner switches the already acknowledged ordinary paid EVM writer and the
retained Solana worker into the reviewed shared supervisor. It changes only
those service activation paths. It does not change financial policy, permits,
roles, read schemas, data, consumer selections, or the separately running
ordinary observer. The owner never asserts that consumer acceptance, scheduled
Solana publication, or a supervised restart has been qualified.

Run consumer operations whose authorization still names the standalone source
before this switch. A later consumer operation must explicitly consume the new
managed source receipt; an old standalone/V4 proof is not a substitute.

## Fixed inputs

The separately staged foundation is `ypal-ordinary-managed-runtime-v1.py` at
`bdaa7a51ed190757567eef4913953a83d7016735f0ae4ebb35599cbcb3b23a63`.
Its fixed root-only input file is
`/var/backups/yunipals-ordinary-managed-runtime-input-v1-20261024/input.json`.
It contains actual ordinary result/input, Solana authentication, and observer
receipt hashes. Pass its exact hash as `--input-sha`; no missing or invented
receipt can authorize the transition. The four public runtime files under
`OPS/ypal-ordinary-managed-indexer-v1` must already be installed, unchanged,
and readable as the restricted child UID. This owner does not stage credentials.

The other dependencies are the pinned f5 handover, its Solana read-only SQL,
the original Solana inventory/config parser, and the pinned kernel-peer proof.
The new namespace extracts only listed lifecycle primitives. Two address casts
use `host(client_addr)` for the existing TCP join; two stop paths also require
recorded process epochs to be gone; all moves use atomic `RENAME_NOREPLACE`.
Frozen historical files remain unchanged.

The initial review verifies the real ordinary source ACK, nine unchanged RPC
actors, actual financial policy, original Solana stage/authentication, exact
legacy worker and typed settings, current serving peers, and the observer's
actual unchanged invocation. It captures all known writer definitions and boot
inodes. Only the standalone EVM source and legacy Solana worker may be active.

## Explicit phases

Run as the existing authorized root host context with Python `-I -B`. Default
invocation is source-only metadata. Each explicit phase takes the shared
nonblocking transition lock and a 300-second overall deadline. Manager commands
are bounded at 130 seconds. Private journals live in
`/var/backups/yunipals-ordinary-managed-handover-v1-20261025`; held original
inodes live in `/etc/systemd/system/.ordinary-managed-handover-v1`.

1. `--review --input-sha INPUT_SHA`: read-only review; prints its deterministic
   binding hash. Native/Solana progress and backend snapshots are recorded again
   at the actual drain boundary, not frozen at an earlier read.
2. `--drain REVIEW_HASH --input-sha INPUT_SHA`: recompute exact review, create
   exclusive journals, then stop the two exact actors once. Positive backend
   capture precedes each durable stop intent, followed by an immediate actor
   comparison. `--finish-drain` only observes already issued stops. If the second
   stop was never issued, use the inverse; finish does not issue a missing stop.
3. `--install --input-sha INPUT_SHA`: while all writer groups are terminal,
   preserve every old boot inode and old parent definition, install the exact
   new parent unit and its new owned boot link, then reload once. The observer is
   unchanged. `--finish-install` observes the resulting definitions after a lost
   reload acknowledgement. A partial install without that reload intent uses
   the inverse. Foreign definitions and racing destination files are refused.
4. `--start --input-sha INPUT_SHA`: verify the original cache restart predicate,
   exact six mounts and frozen stopped boundaries, save start intent, and start
   the parent once. `--reconcile-start` only observes this intent; it cannot
   dispatch another start. A failed or unknown start is never retried.
5. `--finish --input-sha INPUT_SHA`: use the real foundation observation intent
   and subsequent advanced heartbeat to produce the managed lifecycle ACK.
   Repeat observation is allowed; the first accepted ACK bytes are preserved.
6. `--current RESULT_SHA --input-sha INPUT_SHA`: qualify the exact current
   managed epoch via its actual foundation receipt, unchanged private/runtime
   inputs, financial/proxy/observer bindings, and held boot/definition inodes.

If the existing cache restart predicate refuses a stopped source, inspect that
actual refusal. Do not invent unlocked state, alter coverage intervals, or
reinterpret the predicate as accepted. No start intent is created before it
passes. The rollback source start uses the same predicate.

## Concrete inverse

`--inverse --input-sha INPUT_SHA` records a distinct inverse intent. It stops
only an owned new parent, including a partial child tree or an owned pending
restart, and preserves all legitimately advanced native/Solana data. For a
terminal parent, every recorded PID/start epoch must be gone. Remaining shared
Solana-role sessions must be positively mapped to other live kernel clients;
role-wide zero is not substituted for attribution. The dedicated native writer
role must be drained before another writer starts.

The inverse restores exact old boot and definition inodes, reloads once, and
starts only original actors that this operation actually drained. An original
actor never stopped is preserved. No file bytes are deleted. Each new start has
its own exclusive intent, positive kernel evidence, and real new epoch.
`--finish-inverse` reconciles unknown rename/reload/stop/start acknowledgements;
it does not repeat an issued manager action. If an issued action is still
unresolved or a foreign epoch/path appears, it refuses for explicit diagnosis.

The inverse receipt is a new restored-standalone identity. It is never advertised
as the old ordinary receipt. `--restored-current INVERSE_SHA` validates that
identity, all loaded old source mounts, real backend ownership and current
heartbeat freshness against the actual owned start floor. Consumer readiness
and canonical acceptance remain separate.

## Callable interfaces and output

`validate_current_source(receipt_sha, input_sha)` returns the actual foundation
source shape plus the lifecycle producer/result and installation/retirement
claims. `validate_restored_source(receipt_sha, input_sha)` returns a distinct
restored ordinary standalone writer identity. These are source-specific APIs;
callers still compose their own current read/consumer authority.

CLI output is aggregate-only: hashes, fixed status flags and fixed failures.
Complete private operation/actor/definition evidence remains in the root-only
journal. No private receipts belong in the public repository.

Run the focused local tests with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-managed-handover-v1.test.py
```

The tests execute actual frozen lifecycle primitives and kernel socket joins,
real exclusive journals and no-replace filesystem operations, lost-ACK paths,
partial inverse/restarted-source observation, and heartbeat refusal. They do
not execute systemd, a provider request, or production SQL. The separately
reviewed launcher/foundation proofs remain necessary; these tests are not an
actual service handover acknowledgement.
