# Ordinary financial host owner

This owner applies only the already-reviewed ordinary financial delta: four new
permits, shared source allocation 1,500,000 booked CUs/day, account limit
2,000,000 booked CUs/day and unchanged 200,000 foreground reserve. It does not
stop or start a process, alter a unit or timer, change a private environment,
request provider data, renew the profile, or restore the old runtime.

The user’s separate ordinary-budget decision must be recorded as an actual
protected authorization receipt. Approval of unrelated database reads or Arena
work is not a substitute. No ordinary effect can occur before the actual old
catch-up closure, stopped-source receipt and all four restored-free proxy
receipts are present and pass their existing producers.

## Fixed inputs and staging

Stage the new owner as
`OPS/ypal-alchemy-ordinary-financial-v1.py`, where `OPS` is the existing
`/opt/yunipals-unified/operations/free-replay-20261020`. It imports the exact
`19710cfe…` financial Client and `cf7191a5…` ordinary model. The latter’s frozen
relative-path contract also requires the identical public `c77235fd…` profile
at `OPS/ypal-combined-rpc-profile-v1.json`. Stage this copy only if absent; an
existing different file refuses. Do not overwrite the live
`OPS/ypal-combined-rpc-v1/profile.json` or any existing code.

The distinct journal directory is
`/var/backups/yunipals-ypal-alchemy-ordinary-financial-v1-20261024`.
The owner creates it as root 0700, fsyncs its parent, and writes exclusive 0600
receipts. Review may retain multiple content-addressed reviews before any
admission commit attempt. A commit attempt seals the operation against another
admission. Foreign files, another boot, changed producer or changed inputs
refuse. No prior evidence is replaced.

`OPS/ypal-alchemy-ordinary-financial-v1.input.json` contains exactly `format`
(`yunipals-ypal-alchemy-ordinary-financial-v1-input`) and these seven SHA-256
fields. Every hash must come from the actual protected file, not a proposed
future result:

| Input field                   | Fixed file                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `ordinaryAuthorizationSha256` | `/var/backups/yunipals-alchemy-ordinary-authorization-v1-20261024/approval.json`        |
| `catchupPreparedSha256`       | `/var/backups/yunipals-ypal-alchemy-close-v2-20261024/prepared.json`                    |
| `catchupCloseSha256`          | `/var/backups/yunipals-ypal-alchemy-close-v2-20261024/close-result.json`                |
| `sourceDrainedReceiptSha256`  | `/var/backups/yunipals-ypal-alchemy-source-switch-v2-20261024/source-paid-stopped.json` |
| `fourFreeRoutesReceiptSha256` | `/var/backups/yunipals-ypal-alchemy-source-switch-v2-20261024/paid-quiet.json`          |
| `rangeCaptureSha256`          | `/var/backups/yunipals-alchemy-ordinary-range-v1-20261024/input.json`                   |
| `rawRangeSha256`              | `/var/backups/yunipals-alchemy-ordinary-range-v1-20261024/raw.json`                     |

The exact frozen `440f5b39…` source-switch constants include `yunipals-ypal-` in
both the lifecycle and close paths. The owner asserts its paths against those
actual module constants. The v2 `prepare()` copies the original acknowledged
financial preparation into its separate close context; `close-result.json`
must come from the actual v2 close transaction. Do not use the original catch-up
prepared receipt’s hash as the v2 close prepared hash.

The authorization document has exactly:

```json
{
  "format": "yunipals-ypal-alchemy-ordinary-financial-v1-authorization",
  "approved": true,
  "approvalEvidenceSha256": "<actual protected request/reply evidence hash>",
  "userDecision": "Approve these ongoing daily caps",
  "scope": "yunipals-opensea",
  "globalDailyCu": "2000000",
  "sourceDailyCu": "1500000",
  "foregroundReserveCu": "200000",
  "profileId": "0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff",
  "manifestHash": "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
  "existingProfileExpiresAt": "2026-11-19T18:00:00.000Z",
  "existingCatchupExpiryChanged": false,
  "automaticProfileOrPermitRenewal": false
}
```

Root must preserve the underlying actual user decision privately. The hash is
not evidence of a new approval merely because someone can serialize this shape.
This implementation’s first permit set ends at the unchanged existing profile
expiry; it does not negate the separately authorized ongoing daily limits.

The range packet is captured **after** the acknowledged old source drain, four
free-route restoration and financial close. It uses the frozen model’s normalized
four-chain format; this does not claim the historical source actor is current.
Its raw companion has format `yunipals-alchemy-ordinary-range-actual-v1`,
`sourceActorCurrent=false`, `sourcePhase="acknowledged-drained"`, and the exact
`sourceDrainedReceiptSha256`, `catchupCloseSha256` and
`fourFreeRoutesReceiptSha256`. `recordedSource` is the old completion ACK’s
source object (`dd98ef06…`); `sourceActorSha256` binds that historical object.
The schema OID, build and all four checkpoints must match the drained receipt
exactly. Earlier checkpoints or a live-actor claim are rejected.

Before the eight fresh free `eth_chainId`/`latest` requests, the separate capture
uses the frozen `35f75193…` helper’s `capture_sql()` through the existing source
READ ONLY peer. Put its exact result in raw `cacheCapture`, then obtain the
header observations and `observedAt`. The cache capture database clock must be
after both the native drain and actual financial close. The owner runs the same
helper’s `validate_capture(cacheCapture, prepared.plan, drained.native)`:
all 44 native tables, cache OIDs, all 80 real filter prefixes, adjacent-ID unions,
checkpoint identity and the normal Ponder unlock rule are preserved.
`syncCoverageKind="verified_continuous_log_cache"`; each normalized
`syncCoveredBlock` is that proof’s `chains[chainId].logCachedThrough`, not a
stopped process gauge or a claim about downloaded head. The raw companion also
contains `checkpoints`, four `heads` with numeric chain ID/block/timestamp/hash,
`observedAt`, `schemaOid`, `buildId`, `boundedProviderRPCRequests=8`, and zero
`databaseWrites`/`serviceActions`.

The financial owner performs no provider requests. Initial review and the held
admission boundary independently recheck the exact terminal source/free-route
leaf and installed cache semantics. Continuous cache coverage may advance but
must not lose any captured floor; native/checkpoint/cache identity stays exact.
Only then does the frozen model enforce its unchanged 15-minute header/range
freshness bound. The saved financial review expires after five minutes. Thus a
slow old close does not consume the new range packet’s freshness window. Prepare
the public code and input contract first, finish the old close, capture the new
range packet, then review/rehearse/admit within those existing bounds.

## Commands and transaction lifecycle

With no flags the owner emits inert metadata without importing a host or opening
a connection. Other phases require the fixed production hostname and root,
bounded 180-second execution, the existing shared lifecycle lock, then the
existing financial lock. Database subprocesses use the unchanged fixed Unix
peer: UID111/GID113, cleared groups, zero capabilities, NNP, absent password
sentinel and the market database on local socket port 15438. No arbitrary
database, SQL, producer path or command is accepted.

```sh
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --input-sha INPUT_SHA --review
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --input-sha INPUT_SHA --rollback REVIEW_SHA
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --input-sha INPUT_SHA --authorization-sha APPROVAL_SHA --commit REVIEW_SHA
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --input-sha INPUT_SHA --reconcile INTENT_SHA --phase admit
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --validate ADMITTED_SHA
```

Replace `OPS` with the fixed path above and use only actual emitted hashes.
`--review` stores the exact current catalog, authorized proposal and old closure
proof. It invokes the real frozen close receipt chain and paid-quiet leaf, not a
receipt-shape mock. It proves the source’s known process epochs are gone,
attributes remaining source-role sessions, preserves native OIDs/build and
checkpoints, and checks the four acknowledged free proxy actors twice.

An important stopped-source distinction: `0e147… close(resume=False)` leaves the
owned paid ExecStart overlay installed and moves the extra mount fix. It does
not promise an active/free-source configuration. This owner therefore checks
owned files plus actual terminal process/session state; it never calls an
active/free-source validator to fabricate that promise. The real free-proxy
leaf still validates all four restored proxy processes and their owned inputs.

`--rollback` uses the same actual SERIALIZABLE transaction, advisory lock,
seven table locks, 15-second statements, 2-second lock bound and 30-second idle
transaction bound as admission. It requires exact review state, executes the
four INSERTs and two policy UPDATEs, checks the full intended after-state, then
ROLLBACKs and proves the XID aborted. The original additive catch-up closure
rows are validated by the frozen model, not forcibly normalized to 1M/25k.

`--commit` requires that same review’s actual aborted rehearsal and the explicit
new authorization hash. It creates one durable attempt, obtains the real held
XID/backend and kernel child identity, executes and checks the exact delta, then
fsyncs its one-shot intent before the sole COMMIT. After intent, it rechecks the
same drained/free proof, fixed inputs, approval, producer and held child.
Neither counters nor the other six workload allocations are changed.

Lost acknowledgments are handled only by `--reconcile` with the exact durable
intent hash. The path does not require a failure marker and does not resend SQL.
It checks `pg_xact_status(xid8)` and the complete actual financial state. Unknown,
in-progress or aborted XIDs cannot produce a committed ACK. A failed commit
attempt is never automatically retried with another review or permit set.

## Current validation and disable

`validate_current(ADMITTED_SHA)` is a source-independent financial/profile leaf.
It verifies the immutable review/intent/approval chain and the actual budget,
profile, permit and full ACL/column catalog, allowing only valid monotonic usage
and the existing 31-day ledger retention. It does not call the old source,
free-proxy or consumer validators after a legitimate new runtime transition.
Its result explicitly says `sourceActorQualified=false`,
`proxyLifecycleQualified=false` and `timersRetired=false`.

```sh
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --input-sha INPUT_SHA --authorization-sha APPROVAL_SHA --disable REVIEW_SHA
python3 -I -B OPS/ypal-alchemy-ordinary-financial-v1.py --input-sha INPUT_SHA --reconcile INTENT_SHA --phase disable
```

Disable is one exact UPDATE of the four acknowledged ordinary permit rows to
`enabled=false`. It requires their immutable admitted chain and actual current
financial state, but not stale old source/free-proxy identities. It preserves
all spent/booked counters, other permit rows, profiles and the new daily policy
values. A reservation that already succeeded may still finish its authorized
upstream request; this financial ACK is not a paid-traffic-drained claim.
New reservations serialize behind the permit row update and refuse after it
commits. Disable has its own durable intent/XID and read-only reconciliation.

The complete runtime inverse and restoration of the original daily policy are
separate. They require an acknowledged ordinary paid drain/free restoration and
the reviewed inverse policy calculation. This owner deliberately does not
restore old policy rows or arm an expired timer while new actors may be live.

All six old deadline timer/service pairs, their six boot links and the two
completion drop-ins remain outside this owner. The separate handover must
retire their exact owned activation paths only after the old closure and new
financial ACK, before any ordinary paid actors start. No financial ACK can be
used as a source restart, reader cutover, timer-retirement or readiness receipt.

## Local validation

```sh
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-ordinary-financial-v1.test.py
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-alchemy-ordinary-financial-v1.postgres.test.mjs
```

The Python suite uses real protected/exclusive filesystem primitives and a
controlled transaction transport to exercise intent ordering, unknown ACKs,
authorization, identity changes, exact paths and financial-only validation.
The genuine local PostgreSQL test uses the frozen Client’s observation SQL,
the exact new disable SQL and the real reservation function, including a
concurrent blocked reservation. The previously accepted ordinary-model PG
suite separately exercises all six admission statements and the shared daily
allocator. None of these tests claim a production root-peer/lifecycle preflight
has already run.
