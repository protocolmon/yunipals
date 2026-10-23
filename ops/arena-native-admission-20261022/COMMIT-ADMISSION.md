# Dormant native Arena admission: separate COMMIT owner

`commit-admission.py` is a separate finite owner for the reviewed current
227-edge operational graph and13 source-table reads. The original rollback
runner, proposal, SQL, checker and plan remain unchanged. This companion can
create only the nine fresh NOLOGIN roles from those pinned inputs. It does not
set passwords, enable LOGIN, write private connection files, migrate a schema,
change a source selector, stop/start a service or call a provider.

The [actual production read-only review](../../docs/unified-indexer/arena-current-role-production-rehearsal-review-2026-10-23.json)
and [actual two-database rollback result](../../docs/unified-indexer/arena-current-role-production-rollback-rehearsal-2026-10-23.json)
passed with roles8+1 absent again, unchanged scoped ACLs and unchanged original
actors/private inputs. The companion requires these acknowledged bytes, not a
synthetic future receipt. Native coverage is required for adoption/selection;
it is not a prerequisite for these dormant identities.

## Immutable inputs and explicit invocation

Stage the companion, its tests and this document in the same fixed admission
operation directory. Add the existing public inventory helper under its exact
filename there:

| Dependency | SHA256 |
| --- | --- |
| `rollback-rehearsal.py` | `6fc456baf6ade9157b430f40c00fbdbb0e64b1e77486fa8b3921e2ec4c8e2b32` |
| `arena-operational-role-inventory-v1.py` | `c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785` |

The inventory helper is imported only for its finite read-only catalog SQL
builder, never its observation main routine. The protected existing owner11,
runtime-restore and observer dependencies remain those of the rollback runner.
No replay-controller lease, private environment loader or source proxy is changed.

Root must stage the exact already observed review/result bytes at0600 inside
`/var/backups/yunipals-arena-native-admission-rehearsal-20261023/`0700:

| Filename | SHA256 |
| --- | --- |
| `review.json` | `681f04273a57aaaa526b1c41c43e4619f2a78cdb023cc851bf13c501c9b2d5b8` |
| `result.json` | `a7b94fd0222f6bb4476198a76c7dab1a145fc2a613df352933c14003381e69bd` |

The default command is read-only and refuses an existing admission attempt:

```sh
/usr/bin/python3 -B /opt/yunipals-unified/operations/arena-native-admission-20261022/commit-admission.py --rehearsal-review 681f04273a57aaaa526b1c41c43e4619f2a78cdb023cc851bf13c501c9b2d5b8 --rehearsal-result a7b94fd0222f6bb4476198a76c7dab1a145fc2a613df352933c14003381e69bd
```

Only after review and explicit authorization for the separate COMMIT action,
repeat that command with `--commit EXACT_CURRENT_REVIEW_HASH`. The hash is
produced from current retained actor/configuration identities, both actual
unchanged scoped catalogs, the helper and the two acknowledged rehearsal files.
Do not substitute the earlier rollback review hash. There is no automatic retry.

## Two real commit boundaries and recovery

The owner exclusively creates
`/var/backups/yunipals-arena-native-admission-v1-20261023`0700. Each receipt is
exclusive/no-follow0600 and fsynced, including its directory. For each database:

1. Save its attempt intent, then execute the exact pinned SQL up to its final
   COMMIT through the existing bounded nonroot postgres Unix peer connection.
2. Within that same still-uncommitted transaction, append only a read-only
   catalog query. The frozen operational SQL's final RESET ROLE is preserved;
   require session_user=current_user=the fixed PGUSER (postgres in production)
   before accepting the private auth catalog. Validate actual new role OIDs, exact table/column/schema grant
   edges and grantors, all effective positives/negatives, nonowner attributes,
   membership/ownership absence, null passwords and NOLOGIN. Source PUBLIC
   CONNECT/TEMP and the two known non-definer functions remain explicitly
   accounted. Preserve actual OIDs and complete scoped catalog in
   `<scope>-prepared.json` **before** sending COMMIT.
3. Recheck the original actor/configuration context; save the exact prepared
   SHA and original backend PID/start in `<scope>-commit-intent.json`; send the
   single COMMIT. Require the explicit psql acknowledgement after PostgreSQL
   confirms it, child success and a fresh identical role/ACL catalog. Save the
   individual `<scope>-result.json`.

Operational15438 and source5432 are separate transactions. The receipt always
says `databaseBoundariesAtomic:false`. A partial or unknown outcome preserves
all intents, actual prepared OIDs/catalogs and already acknowledged boundaries
in the attempt directory and `failed.json`; it produces no success result and
never drops, re-creates or blindly retries a role. Killing a still-uncommitted
psql child disconnects that transaction. A commit already sent remains an
explicit unknown until reconciled.

`--reconcile` is a separate read-only database action. It requires both owned
prepared snapshots and durable commit intents, the exact original operator,
terminal original backend identities, matching actual OIDs and complete exact
ACL/negative-attribute/password-null catalogs. Only then may it write the
acknowledged aggregate result, preserving any existing explicit individual ACK.
If either database was never prepared, remains absent/mixed, has a live original
backend, or differs in ownership/privileges, reconciliation refuses. A separately
reviewed owner continuation is then required; this helper does not attempt it.
Reconciliation cannot itself commit or change a database.

A success receipt at `result.json` has format
`yunipals-arena-native-admission-v1`, `commitOutcome:'commit_confirmed'`,
`roles:{<eight exact names>:<actual OIDs>}`, `sourceRole:{name,oid}`,
`operationalDatabaseOid:2303669`, `sourceDatabaseOid:17584`, `proposalSha256`,
`sqlSha256:{operational,source}`, `operatorSha256`, `reviewHash` and
`perDatabase:{operational,source}`. Both individual boundaries must be confirmed
and freshly verified. A receipt does not authorize credentials or native startup.

## Shared read-only verifier for credential setup

The credential owner imports this exact pinned companion and calls:

```python
verify_current(actual_admission_receipt, phase="admitted")
verify_current(actual_admission_receipt, phase="passwords", password_sha256=owned_hashes)
verify_current(actual_admission_receipt, phase="login", password_sha256=owned_hashes)
```

`owned_hashes` is the protected exact nine-name mapping to SHA256 of the owned
SCRAM verifier text, never a plaintext password. `admitted` requires NOLOGIN/null;
`passwords` requires NOLOGIN and the exact owned SCRAM digests; `login` requires
LOGIN and those same digests. Current metadata is never rewritten to appear
acceptable. Only the expected stored graph's LOGIN bit changes by phase;
passwords are independently checked in the same read-only snapshot. Every OID,
ACL, grantor, other role attribute and object metadata remains exactly bound to
the original prepared catalogs. Sessions are independently bounded by their
connection limits and must be zero before LOGIN. No password/hash is returned.

The result is `{format,validated:true,phase,catalogs,roleCount:9,databaseWrites:0}`.
The lower `current_catalog`/`validate_catalog` functions support the credential
owner's separate per-database phase boundaries. Password and LOGIN changes,
private-file creation and real TCP identity tests remain that owner's scope.
The inventory/verifier examines the fixed operational schema and two source
namespaces; it does not claim a global absence of all ambient database authority.

## Validation and limits

Local controls cover exact227/13 shapes; OID/grantor/ACL/elevation/password
refusal; the actual public `verify_current` auth phases; real child pipe
acknowledgement and durable-before-COMMIT ordering; lost ACK; changed actors;
partial two-database failure; and read-only reconciliation refusing a live
backend or changed OID. The additional real PostgreSQL16.15 test uses only a
fresh owned disposable database and role in the existing localhost56967 test
container. It executes the actual interactive psql boundary and same catalog
SQL for13 source reads, proves fresh postcommit equality, rejects an actual
extra UPDATE, and validates owned SCRAM/LOGIN phases before full cleanup. A real
restricted-role auth query without RESET is rejected and rolled back; restoring
the session role makes that same catalog query succeed.
It is a synthetic ACL/protocol test, not a native source-data or production
COMMIT result. The actual production227-edge SQL guards/grants were already
exercised by the separately acknowledged rollback rehearsal above.

```sh
python3 -B ops/arena-native-admission-20261022/check-current-proposal-test.py
python3 -B ops/arena-native-admission-20261022/rollback-rehearsal-test.py
python3 -B ops/arena-native-admission-20261022/commit-admission-test.py
python3 -B ops/arena-native-admission-20261022/commit-admission-postgres-test.py
```

The real local PG test verifies the fixed postgres16.15 image and loopback56967
container binding and refuses a preexisting synthetic role. It never connects
to production or reads production configuration/credentials. The companion's
outer alarm is240s; transaction protocol reads45s; catalog reads12s; the existing
SQL lock2s/statement15s limits remain. No production COMMIT has been executed
by the author.
