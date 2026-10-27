# Combined namespace registration

This operation registers the already started `unified_ypal_20261023_v1` /
`71e2a7f3b7` as release
`0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3`.
It reads the exact admitted profile manifest `23d5ca…`; it never calls the old
environment-based manifest builder outside the source unit's bind mounts.

The official seven-module registration closure is unchanged from the installed
`6e112a…` release. A pool of one connects through the local PostgreSQL socket as
the existing postgres Unix/database identity. No provider calls, native writes,
grants, service changes, migrations, `active_release` changes or consumer
selection occur. Registration is valid during backfill and does not represent
coverage acceptance.

Stage only the reviewed `.py` and `.mjs` at their same filenames under
`/opt/yunipals-unified/operations/free-replay-20261020/`, root-owned and without
group/other write permissions. Use the existing E0 root launcher (setuid,
setgid, kill only in bounding/inheritable/ambient sets; no-new-privileges) and
clean environment. The owner acquires the same nonblocking combined transition
lock as the source and route controllers.

1. Run the Python owner without arguments and retain its read-only JSON review.
   It authenticates source controller `3a70a116…`, operation `a80ce9cc…`, actual
   bootstrap receipt `c96d558e…`, exact running actor, schema OID75963410 and all
   44 acknowledged table OIDs, retained fresh YPAL actors, routes and old-source
   drain. The runner also verifies all12 exact source definitions, build and
   fresh heartbeat. All live checks run again within subsequent phases.
2. Run `--rehearse <reviewHash>`. A fresh protected operation directory records
   the exact review and durable rehearsal intent. The unchanged official owner
   executes its insertion in one transaction, with only final COMMIT replaced
   by ROLLBACK. A subsequent read confirms the catalog is exactly unchanged.
3. Run `--commit <same reviewHash>` only after the successful rehearsal. A
   durable one-shot intent precedes the official transaction. Fresh source,
   target absence, unrelated release catalog and active-selector hashes must
   match. A post-insert check in the same transaction accepts exactly the new
   candidate row, preserving every other release and selector.
4. If acknowledgement is lost, do not repeat commit. Run
   `--reconcile <SHA256 of protected commit-intent.json>`; a caught-error
   `failed.json` SHA is also accepted. This path only reads and proves the exact
   new row plus unchanged unrelated catalog/selector. An absent row refuses;
   it does not automatically repeat the insertion. The intent-only case covers
   SIGKILL before the error handler could save a failure marker.

Receipts live in
`/var/backups/yunipals-ypal-combined-release-register-v1-20261023/`.
The immutable candidate row is retained if the source later rolls back. It is
not active and owns no consumer selection. Removing it is unnecessary and is
not part of this owner.

Bounds: overall owner150s; each driver45s; database statement15s,
lock1.5s, idle transaction20s; one connection; zero retries. Public output is
identities, digests and booleans, never credentials or ownership rows.

Local checks execute the actual official registration/readBoundRuntime modules
against a transaction fixture, including unready bootstrap, rollback, exact
insert, stale catalog/source refusal and lost-ACK reconciliation. Python tests
cover durable lifecycle and the actual public bootstrap receipt. They are not
PostgreSQL integration evidence; the production rollback phase supplies that
specific verification before commit.

## Next candidate operations

Create a new immutable ownership read schema with the already installed
normalization artifact `cf333946…`, whose current view creator preserves the
rarityScore string normalization. Do not use source008's older view creator or
reuse the old `35cdcb32` read schema. Capture current finite role permissions
before preparing new physical-source and read-view grants. Existing operational
metadata/Islands/leaderboard tables retain their operational schemas.

After registration, a support worker bound to release4e77 must earn its own
chain observations and receipt qualifications. Consumer activation requires
actual coverage/parity at accepted boundaries. Base metadata needs its own
read identity approval/refresh; marketplace selection uses the existing
review-hash/worker-lock owner; Arena native-to-native switching uses its
existing halted-deployment source owner. The final active_release CAS must bind
the new release and acceptance receipts, rather than reusing old35cd constants.
