# Restored-dataset ordinary observer

This new owner activates the already installed four-chain observer against the
actual restored Yunipals dataset. It keeps the worker artifact, two-connection
pool, free-only RPC policy, UID/GID, hardening, first-cycle acknowledgement and
owned stop/recovery behavior of the original observer. It does not activate on
installation or on source publication.

The actual READ143 admission must exist before review/start. No acknowledgement
or permission is inferred from the prepared source. The old observer producer,
template and receipts remain unchanged; the new operation uses its own namespace.

## Evidence and authority

Initial activation uses `ypal-restored-read-admission-v1.py`'s current validator:
the actual 143 reads, complete column ACLs and acknowledged restored source epoch
must all qualify before the unit or boot link is created. The exact proof and
its initial source context are recorded in the activation chain.

Ongoing validation qualifies the observer's own unit/process/boot link,
installed code, complete support-role rights, native table identities, full
registered manifest, nine independent RPC identities and read-only worker
inspection. Its `dataIdentity` contains the release, manifest hash, schema/OID,
build and digest of all 44 native table identities. The observer does not claim
that the original writer is still the current writer.

The unit has network/PostgreSQL ordering and no `PartOf`, `BindsTo` or
`Requisite` dependency on the physical writer unit. It can therefore remain
active during the separately owned managed-writer transition. While the writer
is unavailable, normal observer readiness can report stale data. A caller must
qualify the actual then-current writer separately and compare its dataset with
the observer's `dataIdentity` around canonical witness observations. Merely
matching this dataset never proves source readiness or writer exclusivity.

`acknowledgement(hash)` authenticates the recorded observer and READ
plan/rehearsal/commit chain without current boot, actor, database or service
inspection. It returns `recordedActivationQualified: true`,
`observerCurrentQualified: false`, `sourceActorQualified: false` and
`currentWriterQualified: false`. It can be used for construction or inverse
ancestry after a later legitimate writer transition. `validate_current(hash)`
is the separate actual observer-current check. Neither API proves canonical
coverage, consumer selections or financial authority.

## Run only with actual protected receipts

The operator, template and their pinned dependencies must first be published,
staged without replacing existing files, and verified on the production host.
Use the actual installed observer artifact receipt and actual new READ receipt;
do not substitute a historical receipt or an example value.

The default invocation without arguments is a static source summary with zero
runtime observations. With `--read-ack` and `--install-ack`, the default performs
the full read-only activation review and outputs its review hash. `--start`
requires those same receipts plus `--expected` containing that freshly reviewed
hash. It creates only its own unit, boot link, intent and result records, then
starts its own observer once. The existing transition lock serializes it with
managed source changes.

After a lost start acknowledgement, use `--reconcile --expected` with the exact
protected start-intent hash. It inspects the original owned invocation and first
completed cycle; it never dispatches another start. A terminal or unfinished
start remains unsuccessful until its explicit stop/recovery is completed.

`--validate --expected` consumes the actual result hash and runs the current
observer checks. `--acknowledgement --expected` authenticates recorded ancestry
only. Keep their different domains explicit in downstream composition.

`--stop --expected` consumes the result hash. `--stop-unknown --expected`
consumes the start-intent hash for an unknown start. They fence the exact unit,
process and boot ownership and record an intent before dispatching stop once.
After a lost stop acknowledgement, use `--finish-stop --expected` with that
stop-intent hash. It waits for authoritative terminal state, removes only owned
unit/boot paths and never repeats stop. These paths require no working source,
healthy database or current READ graph in the constructor. They retain the
original same-OS-boot unit/process ownership boundary.

## Validation and limits

Run `python3 ops/unified-indexer-transition/ypal-restored-ordinary-observer-v1.test.py`.
The 32 local controls include 21 retained ownership/lifecycle controls and 11 new
constructor, data identity, immutable-chain, authority and template cases. The
recorded-chain tests use synthetic protected files; they are not production
activation evidence. Independent review repeats all 32 and checks the explicit
current-versus-recorded authority split.

At preparation time no production observer is running, no unit or boot link
has been created, and no actual READ admission or observer result exists. Actual
host staging, construction, permissions, start and sustained observation are
separate acceptance steps.
