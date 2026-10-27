# Combined ownership and metadata READ admission

This owner prepares one complete read closure for the four existing consumer/cache
roles, the staking role, the existing metadata writer and the restricted support
peer. It adds exactly 143 missing edges: 109 SELECT, 20 EXECUTE and 14 schema
USAGE. The metadata set includes its final worker reads together with the
adopt/refresh/provenance reads. The main API includes both `transaction_candidate`
and `booster_request` for its existing action-evidence endpoint; it does not gain
all booster business tables. The support peer receives only its seven native
observer/receipt reads and native schema usage.

No role, LOGIN, password, membership, limit, operational DML, selector, credential,
provider, source, queue or service operation is performed. Existing collector
LOGIN, operational metadata writes, historical TCG reads and Solana reads remain.
Read admission does not establish native coverage or authorize consumer cutover.

The exact created read-view receipt and private plan are required. The plan
contains the actual catalog baseline and object OIDs. **Keep it private: do not
commit it, publish it, include it in a public source archive, or put its output in
public evidence.** Its fixed protected host path and SHA are pinned in the
operator. The public tests use synthetic objects and contain no actual catalog
or production receipt fixture.

Public source files are the owner `.py`, `.catalog.sql`, `.test.py`,
`-postgres.test.mjs` and this runbook. Stage them only after review. Transfer the
reviewed private plan separately into the operator's fixed root-protected input
path with mode0600; do not overwrite an existing different input. The owner
preserves all frozen predecessor operators and records.

Use the existing clean root launcher on the fixed host. Save full outputs only
in protected private files. The command sequence, with **actual returned** hashes,
is:

```text
python3 ypal-combined-read-admission-v1.py
python3 ypal-combined-read-admission-v1.py --rehearse REVIEW_HASH
python3 ypal-combined-read-admission-v1.py --commit REVIEW_HASH
python3 ypal-combined-read-admission-v1.py --validate ACTUAL_RESULT_SHA256
```

Default review is read-only. It verifies the acknowledged source/registered
release/created view identity, exact current seven-role baseline and retained
consumer definitions/private-input hashes. Rehearsal creates a new protected
operation and executes only the fixed reads in a transaction ending in ROLLBACK.
It records both complete actual permission and collector graphs before proving
that the original catalog and runtime are unchanged.

Commit requires that successful rehearsal. It fsyncs one immutable commit intent
before SQL. Inside the same bounded transaction it compares the complete before
graph, adds only the fixed143 edges, compares the complete rehearsed after graph
and then commits once. The retained runtime is requalified before the result is
acknowledged. All other role attributes, effective rights, owners, object OIDs,
view/function definitions, foreign/PUBLIC grants and existing global direct role
edges are preserved. The catalog deliberately excludes transaction READ ONLY
mode; transport still enforces read-only catalog queries. Default ACLs use their
canonical effective form so a normal REVOKE can restore the original graph
without modifying PostgreSQL catalogs.

If COMMIT acknowledgement is lost, do not repeat commit:

```text
python3 ypal-combined-read-admission-v1.py --reconcile ACTUAL_COMMIT_INTENT_SHA256
```

Reconciliation authenticates the same boot/review/rehearsal and reads the exact
postgraph. It also works when SIGKILL prevented a failure marker. It sends no
GRANT, REVOKE or other write SQL.

The acknowledged result is a new explicit permission authority. Its
`validate_current(actualResultSha256)` export verifies the exact current READ
graph and retained combined source/RPC/YPAL facts. It returns both original and
actual collector graph hashes and `originalWholeValidatorPassed:false`.
The old validators intentionally retain their historical graph predicate.
The new preservation composition copies only pinned function bodies into new
isolated namespaces. It does not change original module globals, query results,
captured graphs, receipts or files. Only the exact owned graph predicate and
its returned actual graph hash differ; all other source, actor, environment,
code, boot, private-file, catalog, profile and route checks remain.

A downstream owner must independently prove its own worker/selection lifecycle.
The exported permission validator therefore does not insist on the old metadata
writer PID or pre-adoption selector/adoption count after a valid downstream
transition, and explicitly returns `consumerSelectionsQualified:false`.

An inverse is available while the original consumers, selectors and metadata
adoption state are unchanged:

```text
python3 ypal-combined-read-admission-v1.py --inverse-review ACTUAL_RESULT_SHA256
python3 ypal-combined-read-admission-v1.py --inverse ACTUAL_RESULT_SHA256 INVERSE_REVIEW_HASH
```

It revokes only the owned143 edges, compares the exact original catalog in the
same transaction, and requalifies the original runtime. It refuses foreign ACLs,
changed consumers/private inputs, new-release metadata adoption or changed source
selection. It never stops/restarts workers or rolls back application data. If its
COMMIT acknowledgement is lost, use `--reconcile-inverse` with the actual protected
inverse-intent SHA. That path validates the owned admission/intent chain and
restored graph, writes only its acknowledgement, and never repeats REVOKE.

Focused checks:

```text
python3 -I -B ops/unified-indexer-transition/ypal-combined-read-admission-v1.test.py
node ops/unified-indexer-transition/ypal-combined-read-admission-v1-postgres.test.mjs
```

The PostgreSQL test verifies the fixed existing disposable localPG16 container,
creates unique synthetic roles/database, and cleans them up. It exercises READ
ONLY baseline versus read/write rehearsal, all143 grants, exact commit,
foreign/PUBLIC refusal, retained collector LOGIN/TCG20/Solana9/metadata writes,
read-only lost-ACK catalog reconciliation, post-adoption inverse refusal, exact
REVOKE inverse and duplicate refusal. It does not contact production/providers.
