# Combined immutable read views

Candidate release4e77 is actually registered (protected registration receipt
`39b96784…`). This owner creates only
`yunipals_ownership_4e77f52b_v4`, identity
`0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67`.
It does not grant access, select consumers, publish `active_release`, start
services, modify native/operational data or make provider requests.

The owner authenticates the installed normalized artifact `cf333946…` through
its existing installer and receipt `14ca61da…`. The pinned preparation091cdf86
contains the19 statements recorded from that artifact's official source
implementation: one schema, one marker table/row, four protected invoker
functions, four PUBLIC revocations and eight views. This is the same established
official-statement execution path as the earlier v4 owner, with a new immutable
release/schema identity and no grants. Source71e is not rebuilt.

Stage the exact reviewed Python owner and
`ypal-combined-readview-v1.preparation.json` under
`/opt/yunipals-unified/operations/free-replay-20261020/`. Preserve the existing
registration/source/route owners and normalized artifact. Run with the existing
clean E0 root launcher; the owner acquires the shared combined transition lock.

1. Default invocation is read-only. Save its returned `reviewHash`. It requires
   the exact acknowledged source actor/schema/table OIDs, actual registered
   release/12 source definitions, fresh target absence, unchanged retained YPAL
   actors/routes and old-source drain. It captures old read-schema definitions,
   ACLs/OIDs and active selectors.
2. `--rehearse <reviewHash>` creates a fresh protected operation directory,
   fsyncs its parent and saves the review/intent. All19 statements run in a
   bounded PostgreSQL transaction that ends with ROLLBACK. The saved rehearsal
   contains actual PostgreSQL-normalized definitions and ACLs, omitting only
   newly allocated OIDs. It refuses unexpected non-owner/default privileges,
   extra objects, incorrect marker or SECURITY DEFINER functions. A fresh read
   proves the prior catalog is unchanged and the new schema remains absent.
3. `--commit <same reviewHash>` requires that exact successful rehearsal and a
   fresh source/catalog comparison. A one-shot durable commit intent precedes
   SQL. Before COMMIT, the newly created objects must match the rehearsal's full
   definitions, columns, identity and ACLs; all prior captured objects/selectors
   must remain unchanged. The acknowledgement records actual new schema,
   relation and function OIDs, plus bounded read-only readiness probes for all
   six collections and Base metadata.
4. If acknowledgement is lost, do not repeat commit. Use
   `--reconcile <SHA256 of protected commit-intent.json>`. This authenticates
   the same boot/review/rehearsal and reads the exact resulting catalog. It also
   works if SIGKILL prevented a failure marker. Missing or mismatched objects
   refuse; no SQL insertion/creation is retried.

Protected receipts:
`/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023/`.
The resulting views remain dormant until a separately reviewed grant and
consumer-selection operation. If the source rolls back, retain this immutable
candidate schema; no destructive removal is needed.

Bounds: one local peer connection per catalog/DDL invocation,30-second server
statement timeout,3-second lock timeout,40-second idle transaction timeout,
55-second child timeout,180-second overall owner limit. All catalog reads and
DDL use `search_path=pg_catalog`; original catalog array order is retained when
stripping transient OIDs so collation cannot cause a false comparison.

Local evidence includes eight genuine PostgreSQL16 checks against the exact
generated SQL and eight lifecycle/negative unit checks. The disposable fixture
uses actual Ponder table definitions; it proves DDL rollback, guarded commit,
unchanged prior view, default ACL refusal, protected normalized functions,
fail-closed readiness, read-only reconciliation and duplicate refusal. It does
not claim production coverage or grant/consumer acceptance.
