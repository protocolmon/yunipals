# Bounded production rollback-only rehearsal

`rollback-rehearsal.py` is a separate owner entrypoint for the frozen current
proposal. No production execution has been performed by its author. It has no
commit, LOGIN, credential, migration, service or source-selection mode.

Stage the complete reviewed admission package at the fixed root-owned directory
`/opt/yunipals-unified/operations/arena-native-admission-20261022`, retaining all
five input hashes embedded in `PINS`. Add only the new runner and its public test
and this document; do not rewrite historical SQL, proposal, dry-run plan or
checker. Existing exact dependencies are:

- `free-replay-20261020/yunipals-arena-runtime-restore-v1-20261022.py`, SHA
  `505a4937867abdc623b7d21367bf76a42ecea4a103d374116dbb3181fb60febb`;
- its pinned owner-v11, observer and public original-worker baseline;
- acknowledged owner-v11 and original-runtime restore receipts and their
  protected retained input bindings, already identified by the current proposal.

The runner checks the eight original active actor identities and definitions,
ordered environment and credential selectors, unchanged private-input hashes,
no pending owned service jobs, and absence of all nine future native private
files. It does not open credential values for export, import application code,
acquire the replay controller lease or stop any worker. It compares complete
scoped schema/relation/column/function/database ACL metadata before and after
rehearsal. Ongoing application DML and unrelated scopes are not frozen.

Run the read-only review first, as the existing root operator on `yunipals-main`:

```sh
/usr/bin/python3 -B /opt/yunipals-unified/operations/arena-native-admission-20261022/rollback-rehearsal.py
```

After independently reviewing the actual output and authorizing this rehearsal,
pass its exact public `reviewHash` (the example is a placeholder):

```sh
/usr/bin/python3 -B /opt/yunipals-unified/operations/arena-native-admission-20261022/rollback-rehearsal.py --rehearse READONLY_REVIEW_SHA256
```

Each fixed PostgreSQL target uses the existing nonroot `postgres` peer account,
Unix socket, no password or inherited environment, NNP and cleared groups/caps.
The two fixed targets are operational15438/yunipals_arena followed by
source5432/yunipals_backfill. The authenticated SQL is changed only by replacing
its exact final `COMMIT;\n` with `ROLLBACK;\n`. No other SQL is inserted into
those transactions. The SQL's own exact database/schema/object/migration guards
execute against the current catalog. All eight operational roles must remain
absent after the first transaction and the source role absent after the second.

The overall alarm is180s, each SQL child45s, statement15s and lock2s. The helper
captures and suppresses raw command errors, has no automatic retries and never
issues COMMIT. A failing child disconnects its uncommitted transaction; treat
interruption/lost acknowledgement as requiring fresh role/ACL reconciliation
rather than assuming the success result. Only two fully acknowledged rollbacks,
unchanged scoped catalogs and unchanged actor/configuration context produce
`rollback_rehearsal_passed`.

This is real transactional CREATE ROLE/GRANT execution followed by rollback,
so it can consume PostgreSQL OIDs and generate WAL. It claims zero persistent
role/grant changes, not zero PostgreSQL work. It does not enumerate effective
permissions inside the transient transactions: that separate real-role,
credential and TCP acceptance remains required after a separately reviewed
NOLOGIN admission commit. Native coverage is required before adoption or
selection, not for this dormant-role rehearsal.

Local controls, with no database/network/service action:

```sh
python3 -B ops/arena-native-admission-20261022/check-current-proposal-test.py
python3 -B ops/arena-native-admission-20261022/rollback-rehearsal-test.py
```
