# Current native Arena admission preparation

The production read-only checks now show **all eight dedicated operational roles and the separate source-reader role absent**. All nine final native overlay files are absent too. This package creates a concrete finite admission proposal from that state; it has not created a role, granted access, written credentials, run a migration, stopped a service or changed a source selector.

The twelve official migrations are already committed with their exact checksums. The eight original workers still match the runtime-restore receipt, including invocation/PID/start/UID971/GID965/argv/cwd/cgroup, original definition hashes and unchanged private source hashes. The deployment is legacy, not halted, has no source selector and retains two legacy identities. There is **no extra eight-worker legacy-upgrade round** in this proposal. Original workers continue serving until the single reviewed native cutover is ready.

The four actual observations are identified by SHA256 in `proposal.current.json`:

| Observation | Local retained evidence |
| --- | --- |
| Actual role OIDs, relation OIDs, effective privileges and twelve markers | `/tmp/yunipals-arena-current-role-catalog-readonly-20261022.json` |
| Database/schema OIDs, PUBLIC privileges, matching HBA methods and headroom | `/tmp/yunipals-arena-current-role-targets-readonly-20261022.json` |
| Fresh eight restored actors, definitions and private-input equality | `/tmp/yunipals-arena-retained-actors-readonly-20261022.json` |
| Presence/metadata of nine native overlay paths; no contents read | `/tmp/yunipals-arena-native-private-path-presence-20261022.json` |

They contain catalog metadata, hashes, identities and aggregate counts, not credentials or private record payloads. The exact current grants outside the two source namespaces and operational schema have not been exhaustively enumerated; the source ambient privileges below are explicitly retained, not hidden by the finite direct-grant list.

`operational-roles.current.sql.review` retains the historical role names, NOLOGIN/nonowner/NOINHERIT attributes, connection limits and 207 required table/column edges. It adds only the seven current-runtime statements measured by the 13-group real PostgreSQL test: twenty edges for artwork identity jobs, the sampler's six selected observation columns, and media capacity-cache invalidation. The resulting exact graph is 227 edges. All operational grants, including the current delta, execute as `yunipals_arena_owner` for a consistent grantor. No function EXECUTE, migration/selector write, durable-history DELETE, role membership, default ACL change or old-role alteration is added. Fresh-name checks, operational database OID2303669, schema OID2303670, owner OID2303667, all 27 current relation OIDs and the exact twelve markers are guarded.

`source-reader.current.sql.review` creates only fresh `arena_native_reader` NOLOGIN, limit32, database CONNECT and USAGE/SELECT for the same nine physical and four control relations. It guards database OID17584, both schema OIDs and thirteen relation OIDs. This does not select or publish that source. The source database already grants PUBLIC CONNECT and TEMPORARY, and two scoped functions are PUBLIC-executable SECURITY INVOKER functions. A new role inherits that existing ambient authority. This proposal neither expands nor broadly revokes it, and does not claim literally SELECT-only effective authority across the whole database. The source connection itself must keep its read-only session option; native consumers receive no write grant on permanent source/control objects.

At observation time operational PostgreSQL had24 sessions, max96 and3 reserved:69 ordinary slots remained versus60 proposed operational pool slots. Source PostgreSQL had27 sessions, max100 and3 reserved:70 remained versus31 source-pool slots. Those are snapshots, not reservations; check headroom again immediately before admitting processes.

Static local review:

```sh
python3 ops/arena-native-admission-20261022/check-current-proposal.py
```

The companion tests verify the exact edge parser and refuse added authority, LOGIN, source writes, stale marker state and a migration-replay plan. They make zero database or network calls.

## Finite role and private connection preparation

The new SQL files are review inputs with final `COMMIT`; do not pass them to a production connection as an inventory operation. The dry-run plan binds their exact hashes and requires changing **only the final transaction terminator** to `ROLLBACK` for the later owner rehearsal. That rehearsal is not executed here. It will prove the fixed guards and grants against the real catalog without retaining the roles. Actual commit is a separate exact reviewed invocation and must produce the eight new role OIDs plus the source role OID. A lost SQL acknowledgement requires name/OID/catalog reconciliation; no blind creation retry or adoption of an unknown role is permitted.

Role creation can be prepared while native history is still catching up because it grants only dormant NOLOGIN identities. It does not require stopping the old workers or changing mode. No password or LOGIN action is included in these SQL files.

Existing loopback HBA rules already match SCRAM-SHA-256 for all eight operational names on15438 and the source name on5432. No HBA edit is indicated. This is catalog-policy observation, not a successful TCP authentication test.

The later bounded credential setup must:

1. Bind each newly acknowledged role OID and exact negative attributes/ACLs. Recheck the nine paths are absent. Use separate random passwords for all nine names, SCRAM verifiers via private stdin, and root-owned0600 exclusive/no-follow environment files. Only hashes/OIDs/target-match results may enter public receipts. Passwords never enter argv or logs. Reuse only the small password/SCRAM/file primitives from `ops/arena/provision_database.py`; do **not** run its provisioning main routine, migration or broad app grants.
2. Put each role's operational URL in its existing proposed `/etc/yunipals-unified/consumers/arena-*.env`, targeting unchanged `127.0.0.1:15438/yunipals_arena`. Put the separate source URL in `/etc/yunipals-arena/native-read.env`, targeting the observed local source database. Preserve ordered environment files and retained public selectors. Keep all roles NOLOGIN until the owned role/config acceptance; a later bounded LOGIN change and real TCP test are separate from role creation.
3. Preserve original `runtime.env`, `database.env`, provider files, strategy/admission/operator/referee keys, actual approved funding/budget settings and source replay/proxy configuration byte-for-byte. Lobby `execution.key` remains the operator key; referee execution uses the referee key. API/disclosure/client gain no provider or execution key; providers gain no execution key. Native entries/new lobbies remain false as already proposed.
4. Run catalog/effective-permission negatives under the actual recorded OIDs and prove real TCP `session_user=current_user`, no membership/owner/elevated capability. The 13-group disposable-PG proof supports the finite graph but does not replace production authentication and source-role read acceptance.

## Direct adoption after source readiness

The candidate is the full1796-file source264a3322 with manifestfe6a122b. The active build is not a cutover. Actual completed build, immutable install and constructor qualification hashes must be supplied; no guessed future receipt is frozen here. `arena-modern-runtime-preflight-v1.py` first qualifies the candidate constructor+close under retained real mount/config contexts. Native source coverage/canonical observations, dedicated role/auth acceptance, and source selection are separate checks.

Do not rerun `arena-normal-adoption-launch-v7.py` or any owner-migration operator: its materialized owner expects the unmigrated target and obsolete runtime. Its existing v9 adopter also pins the historical3c source. Reuse the reviewed business functions and preservation logic in a **new committed-schema cutover owner**, bound to these actual owner-v11 and restore-v1 receipts, candidate installation/constructor receipts, normal-source receipt and fresh native witness. That concrete owner is the remaining implementation artifact; this package does not falsely claim it exists.

The owner must perform this one finite transition:

1. Before downtime, verify all12 markers/current objects, exact old8 actors and original boot paths, nine role/config receipts and candidate/native unit hashes. Require real current native source coverage through the accepted floor and canonical opening observations for both legacy identities, using the existing source/action verifier. No source mode/selector/adoption write occurs while replay is not ready.
2. Bind a fresh private-state backup and equality seal, then gracefully stop the exact old8 once and prove sessions/cgroups drained. Preserve provider UUIDs, spend/candidate records, raw signed bytes/nonces/receipt histories, ciphertext and original cipher contexts. Record and remove only owned old boot activation paths before any native startup; new native units remain inert until the owner reaches their start step. Recheck original private inputs. No schema migration is invoked.
3. Under the existing source-selection and old-projector advisory locks, set only the recorded deployment to halted unified mode. Invoke the candidate's existing `adoptLegacyTournamentIdentity` for the two verified origins, retaining `deployment/tournament` AAD and every non-incarnation private byte. The existing `reviewOrigins`/`privateSeal`/`adoptOrigins` logic supplies the useful bounded preservation checks; its historical runtime/terminal launcher must not be reused unchanged.
4. Use the existing guarded `ArenaSourceSwitch` review/exact-hash application to publish the source epoch with the actual accepted block/hash floor. It must find no legacy identities, match the complete source/action evidence, preserve durable private state and write immutable selector history. Adoption and source publication are separately acknowledged commits in the existing implementation; record both boundaries rather than pretending one CLI atomically performs them.
5. Start the eight reviewed native units once with the dedicated nonowner operational credentials and read-only source connection. Verify their canonical source/epoch, actual API behavior, provider/executor fencing, schedules and public route before restoring the recorded deployment halt state. Retain the original worker definitions/runtime/backup as owned recovery material.

Before any adoption commit, a failure may restore the exact old mode/boot paths and restart the original8 after proving no selected/native writer or external effect. **After adoption commits, restarting the pre-adoption old runtime is not an automatic inverse**: private rows now have native incarnations. Before native workers/effects exist, an explicit proven restoration of the fresh pre-cutover backup can recover the original state. After native actions start, use the existing compatible source-switch/isolated-public rollback path with durable native identities and private history preserved; do not bulk restore or rewrite AAD/provider IDs/nonces. The cutover owner needs these real boundary-specific recovery gates before live execution.

Current concrete gaps are therefore: nine dormant role creations/grants and their actual OIDs; nine private connections and authentication/ACL proof; completed candidate build/install/constructor receipts; real native coverage/origin witness; and the new committed-schema direct-native owner. There is no remaining schema migration or extra legacy-worker upgrade prerequisite.
