# Isolated public Arena rollback target

This package prepares one **new public projection database**, not an operational Arena restore. It is local source and test evidence only. No production database, role, credential, scanner, service, source selector or worker was changed while preparing it. The pending nine-role/240-grant authorization does not include this separate target; future admission and credential phases need their own explicit authorization.

The fixed target is `yunipals_arena_public_rollback` on the existing PostgreSQL cluster at port5432. Its `yunipals_arena` schema contains exactly four ordinary tables: `deployment`, `chain_event`, `tournament`, `credit`. The deployment is constrained to Base8453 / `0xebd141b6ae36f74fe70b9139b262ee9771b72aca` / start52648146. No private submission, ciphertext, provider, execution, source-selector or migration-marker table is created. `migrateArena` is never invoked.

A separate database fits the existing `ArenaRollbackSource` hardcoded schema and official source-switch endpoint-isolation checks without changing application code. It adds a small database/template copy and separate credentials. It shares the source cluster's disk, connection limit and failure domain; this is not a separate physical database server. The existing private operational database at port15438 remains separate. New target admission requires its database name and all three role names to be absent in a fresh read-only catalog.

## Exact authority

| Role | Initial state | Connection limit | Target rights |
| --- | --- | --- | --- |
| `arena_public_rollback_owner` | NOLOGIN, NULL password | -1 | Owns only the new database/schema/tables; never enabled |
| `arena_public_rollback_writer` | NOLOGIN, NULL password | 2 | CONNECT, schema USAGE; SELECT/INSERT on chain_event; SELECT/INSERT/UPDATE on the other three tables |
| `arena_public_rollback_reader` | NOLOGIN, NULL password | 32 | CONNECT, schema USAGE, SELECT on four tables; default transactions read-only |

All three roles are NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION and NOBYPASSRLS, without memberships. The two runtime roles cannot CREATE/TEMP in the target database, CREATE in either target schema, own target objects, DELETE/TRUNCATE/REFERENCES/TRIGGER target tables, or UPDATE existing chain events. PUBLIC CONNECT/TEMP in the **new database** and PUBLIC authority in its `public` schema are revoked. It contains no user functions, default ACLs, private tables, extra relations or user triggers.

The verifier records exact table/schema/database/role OIDs, grantor/grantee edges, constraints, indexes, columns and shared role dependencies. Explicit ownership or ACL dependencies in a foreign database are refused. Future catalog validation compares those actual recorded identities; a same-name replacement or extra grant is not normalized away.

Existing PUBLIC privileges in **other databases in the same cluster** may give the new runtime roles ambient CONNECT, TEMP or function rights there. This package does not revoke those cluster-wide defaults or modify HBA. Safe database-OID/privilege booleans are disclosed in `ambientDatabaseAuthority`; the package makes no claim that global PUBLIC authority is absent. Only explicit foreign grants/ownership are rejected. Future operator review must assess the existing HBA/PUBLIC posture before enabling these new logins.

## Acknowledged admission

Install the finite public package unchanged under protected `/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/`. Default execution is read-only:

```bash
python3 /opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py
```

It checks the actual maintenance database OID17584, operational database OID2303669, port/server identities, absence of the new database/roles/credential paths, and exact public SQL/proposal hashes. Its returned `reviewHash` binds those actual observations and owner bytes. After separate authorization, use that exact fresh review:

```bash
python3 /opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py \
  --apply "$ARENA_PUBLIC_TARGET_REVIEW_HASH"
```

The owner uses four distinct boundaries; it does not claim one atomic transaction:

1. Create three dormant roles in a transaction. Fsync their actual new OIDs/catalog and transaction ID before sending COMMIT; require an explicit ACK.
2. CREATE DATABASE from template0 with connections disabled. Persist an intent naming the already recorded owner role OID before this nontransactional command; require its command ACK and a fresh matching owned database OID.
3. While disabled, revoke PUBLIC database privileges and grant only the two target CONNECT edges. Enable connections only after those ACLs are in place. This transaction has its own prepared catalog/XID/ACK.
4. Create the exact four-table schema and finite grants. Capture the real complete catalog before COMMIT, then verify it again after ACK. It must be empty at admission.

Only after all boundaries are acknowledged and verified is the protected result written:

`/var/backups/yunipals-arena-public-rollback-target-v1-20261023/result.json`

Its format is `yunipals-arena-public-rollback-target-v1`, with `commitOutcome="commit_confirmed"`, actual `database`, `serverIdentity`, `schema`, `tables{name:oid}`, `ownerRole`, `writerRole`, `readerRole`, exact proposal/SQL/operator hashes, full scoped `catalog`/`catalogSha256`, and four explicit `perBoundary` acknowledgements. There are no guessed future OIDs in this package.

For an interrupted/unknown command:

```bash
python3 /opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py --reconcile
```

This is read-only. It reports actual known aborted/absent/unprepared role prefixes, recorded transaction statuses and owned disabled/accessible database identity. It neither retries DDL nor drops anything nor fabricates a complete admission receipt. A lost CREATE DATABASE ACK can leave the exact owned database present with connections disabled; retain it and its intent for separately reviewed recovery. An existing attempt namespace always refuses a fresh apply. No DROP/automatic cleanup path exists in the production operator.

## Separate credential phases

The admission result leaves all roles NOLOGIN/passwordNULL and writes no private connection files. `credentials.py` is a separate review-first owner. It requires the **actual** admission result SHA and exact admission-helper SHA; neither is supplied as a fake future value here. The two new paths are exclusively:

- `/etc/yunipals-arena/public-rollback-writer.env`
- `/etc/yunipals-arena/public-rollback-reader.env`

Each file is root0600, contains one `ARENA_PUBLIC_ROLLBACK_DATABASE_URL` key, and is never overwritten. It does not change any original eight operational role/environment files, `native-read.env`, provider/key configuration or source-selector overlay. Runtime transport of these new URLs to the future scanner/compatible workers belongs to the separately reviewed rollback controller.

Review each phase separately, adding `--apply "$ARENA_PUBLIC_TARGET_PHASE_REVIEW_HASH"` only after that exact phase is authorized and reviewed:

```bash
python3 /opt/yunipals-unified/operations/arena-public-rollback-target-20261023/credentials.py \
  --admission-helper-sha256 "$ARENA_PUBLIC_TARGET_HELPER_SHA" \
  --target-result-sha256 "$ARENA_PUBLIC_TARGET_RESULT_SHA" --phase setup
```

Use `--phase enable` for the subsequent LOGIN review, and `--phase auth` for read-only TCP proof. Setup writes two distinct random password files and changes only the two new runtime roles' SCRAM verifiers, keeping NOLOGIN. Enable changes only those two roles to LOGIN. Each SQL phase captures real catalog/XID/ACK evidence. The owner role always stays NOLOGIN/passwordNULL.

Auth proves each exact role/OID/database over TCP, rejects a wrong password and owner-role escalation, reads all four public tables, and proves forbidden writes are denied by SQLSTATE42501 even in an explicit read-write transaction. Passwords travel to libpq through an inherited sealed anonymous0600 pgpass descriptor, never argv, environment or repository files. The source/operational credentials are not reused.

The future acknowledged auth result is:

`/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023/auth-result.json`

Format `yunipals-arena-public-rollback-auth-v1` binds `targetResultSha256`, admission/credential helper hashes, actual role/database/table identities, `setupResultSha256`, exact two private file hashes/inodes, SCRAM verifier digests and actual TCP proof. It must have `credentialsConfigured`, `loginEnabled`, `tcpAuthenticationProven` and `grantsVerified` all true. Unknown setup/LOGIN ACKs retain intents and files and refuse replay/rotation; credential `--reconcile` reports their exact known phase/XIDs read-only and creates no new acknowledgement.

The rollback controller can load the exact admitted helper and call:

```python
validate_target(actual_admission_receipt, auth_phase="login")
```

With no explicit password argument, this also loads the protected actual setup/auth receipts, same helper/file/SCRAM pins, and verifies the current LOGIN/OID/ACL/object/dependency graph. It returns `validated=true`, actual target identities, `databaseWrites=0`, and the separately disclosed ambient database privileges. Explicit verifier hashes are reserved for the credential owner's own before/after transition checks, before its final auth receipt exists.

## Scanner and source-switch boundary

Provisioning this empty target does **not** prove replay coverage, parity or readiness, and starts no scanner. The separate controller must run the official `projectConfirmedArena` against only this writer credential, with the reviewed exact adapter suppressing its two legacy private disclosure queries. No private stub tables/views or migration are added to satisfy those queries.

The fallback scanner retains the existing Base depth3 confirmation policy. This does not change normal Ponder's latest-block policy. Official `ArenaRollbackSource` still requires recent complete cursor coverage, accepted floor/current canonical hashes and correct current opening/input proofs. Only a later official `ArenaSourceSwitch` may select it; modern compatible workers retain the operational private database, identities, UUIDs, signed bytes and provider state. The original legacy runtime is not a rollback target after native adoption.

## Local verification and limits

```bash
python3 -B ops/arena-public-rollback-target-20261023/test.py
python3 -B ops/arena-public-rollback-target-20261023/postgres-test.py
```

The real test verifies the retained disposable `postgres:16.15` container at127.0.0.1:56967, proves its exact fixture database/three role names absent, and cleans up only what it creates. It exercises real role/database/schema/ACL admission, lost CREATE ACK preservation, real lost COMMIT ACK plus `pg_xact_status`, four-table absence of private objects, denied writes, actual extra/default/foreign grants, separate credential phases, current SCRAM drift rejection and two real SCRAM TCP identities.

The executor has no host `psql`, so its TCP fixture uses the existing Node `pg` client on the same loopback PostgreSQL16.15 instance; production owner transport remains `psql` with the sealed pgpass FD. Offline controls verify that FD transport excludes passwords from argv/environment, rejects unexpected SQLSTATE/network errors, preserves inode ownership and never overwrites private files. The separate controller owns projector/adaptor parity and actual source-switch tests. No production/HBA/current-wallet/provider/end-to-end rollout acceptance is inferred from these local tests.
