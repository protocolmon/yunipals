# Owned ordinary observer admission

The artifact installer and this activation owner are separate. The installer
creates only immutable public runtime files. This owner installs one fixed unit,
one owned boot link and one ordinary observer invocation. It never starts another
Ponder/Solana scanner, changes grants, selects readers or renews RPC authority.

The exact serving template has `RuntimeMaxSec=infinity`. It does not impose an
hourly renewal or permission gate on live readers. `Restart=no` makes an unexpected
exit visible rather than silently substituting an unacknowledged invocation.
Normal operation continues until explicitly stopped, source dependency failure,
process failure or host shutdown. The final supervisor must explicitly adopt or
retire this owner's boot link and retain the same official loop. Its replacement
must not overlap the existing release-specific session lock.

## Initial qualification and fixed effects

Initial review requires two actual SHA-256 arguments: `--read-ack` for the
successful protected 143-read admission and `--install-ack` for the protected
inert artifact installation. Neither is inferred or represented by a placeholder.
Missing, changed, inversed or unqualified receipts refuse before activation.

The initial review uses the immutable read-admission validator while its complete
graph is still current. It then independently checks the acknowledged source
process/argv/private inputs/build/catalog/table identities, registered release,
free-only four-proxy profile and original route actors. It checks the support
account, the finite required native SELECT/control privileges and that the support
role has no elevated authority or table ownership. The role's own effective
permissions/memberships are captured; another reader's later grants are not part
of that snapshot. Existing support sessions and the old support unit must be
terminal before admission. Pool headroom is checked without changing limits.

The installed command is inspected as the real support UID/GID before mutation:
it loads the registered source and exact source manifest from the database,
performs no RPC, makes no writes, and exercises actual dependency/peer access.
No generic command, alternative profile, role, source schema or unit path can be
passed to this owner.

After the fresh review hash matches, the owner writes a private operation record
and durable installation intent; creates the fixed unit exclusively; records its
inode; creates and records its exact boot link; reloads only manager definitions;
rechecks its captured scoped inputs; and saves a durable start intent before the
single fixed manager start. Immediately before dispatch it checks the same unit
state/inode. Start acknowledgment requires the exact process, command, environment,
zero capabilities, cgroup and loaded hardening. All four control revisions must
advance after the captured baseline before an ACK is saved. A waiting/error/finality
state remains visible in that ACK and is not promoted into source acceptance.

## Commands and outcome boundaries

All receipt data stays in the fixed root-private operation directory. Paths and
actual SHA values below are inputs to the reviewed owner, not new authorization:

```
python3 -I -B OWNER --read-ack ACTUAL_143_SHA --install-ack ACTUAL_INSTALL_SHA
python3 -I -B OWNER --start --read-ack ACTUAL_143_SHA --install-ack ACTUAL_INSTALL_SHA --expected FRESH_REVIEW_SHA
python3 -I -B OWNER --validate --expected ACTUAL_RESULT_SHA
```

`OWNER` is the fixed installed
`/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-ordinary-observer-owner-v1.py`.
The result is
`/var/backups/yunipals-combined-ordinary-observer-owner-v1-20261024/result.json`,
format `yunipals-combined-ordinary-observer-owner-v1`.
The exact owner and dormant serving template are staged. No command above has
been run on production by this preparation; no unit or boot link was created.

A command deadline or missing output is not a failed service start. If the start
intent exists but the ACK does not, inspect that exact intent SHA and use:

```
python3 -I -B OWNER --reconcile --expected ACTUAL_START_INTENT_SHA
```

This never calls StartUnit. It authenticates the same boot, review, unit/boot
records and exact original start window, then requires the live owned invocation
and completed first observer cycle. An active job, terminal process or changed
identity refuses. There is no retry of an uncertain mutation. A partial
installation before the start intent is retained for separate read-only
inspection; it cannot be turned into another automatic activation attempt.

## Subsequent qualification and coordinator contract

`validate_current(actual_result_sha)` is the fixed read-only leaf for the same
acknowledged observer invocation. It validates its immutable producer/artifact,
unit/boot/input identity, support role, source actor/build/catalog, registered
release and unchanged free proxy policy. It rechecks these around the actual
read-only peer inspection. It does **not** rerun an obsolete whole-consumer-role
graph after legitimate cache/reader changes.

The output explicitly includes:

- `validated: true`, `observerScopeOnly: true`, `ordinarySustainedObserver: true`;
- `runtimeMaximumSeconds: null`, exact actor/invocation/start and owned boot link;
- `freeOnly: true`, `paidAuthority: false` and exact combined release;
- `original143CurrentWholeValidatorPassed: false`;
- `readerSelectionsQualified: false`, `sourceCoverageAccepted: false`.

This leaf is not a receipt for the cache's four added reads or reader LOGIN
changes. The publication/reader coordinator must compose those actual owned
receipts separately, along with canonical per-chain observations and its real
preview checks. No circular producer pin is needed: the observer does not import
that later coordinator or any publication proof.

## Exact inverse

```
python3 -I -B OWNER --stop --expected ACTUAL_RESULT_SHA
python3 -I -B OWNER --stop-unknown --expected ACTUAL_START_INTENT_SHA
```

The inverse stops only the exact owned observer, with another identity check
after its durable stop intent. It does not need a healthy upstream, source
heartbeat or old consumer graph. Once the authoritative unit is terminal, jobless
and its cgroup empty, the owner records removal intents, unlinks only its exact
boot and unit inodes, reloads definitions and acknowledges absence. Control
observations, source data, other units and all receipts remain intact.

If a stop acknowledgment was lost, use the recorded stop-intent SHA:

```
python3 -I -B OWNER --finish-stop --expected ACTUAL_STOP_INTENT_SHA
```

This does not repeat StopUnit. It requires authoritative terminal state before
finishing its own removal. Foreign boot/unit files, a changed actor or a running
job refuse; no broad cleanup or rollback of database observations is attempted.
A common source-transition lock serializes owner operations. The 420-second
owner deadline bounds the operation, not the lifetime of its ordinary worker.

## Verification scope

The source entry has 18 focused controls and eight real PostgreSQL groups,
independently rerun, plus equivalent built-bundle PG coverage. The owner adds
21 local lifecycle/receipt/boot/ACL controls and seven genuine PostgreSQL catalog
checks, including unrelated reader LOGIN/grants leaving its own role snapshot
unchanged and real table/column-only native-write and missing-control authority refusal. Tests use
synthetic data only. Runtime systemd property/peer qualification, actual admission
receipts, installed dependency context and activation ACK remain host checks.
