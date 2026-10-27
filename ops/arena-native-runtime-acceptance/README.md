This extends the immutable historical `ops/arena-native-role-review` proposal with an executed current-runtime operational test. It does not change that proposal or any frozen business source.

Run from `apps/yunipals-market-api` with the existing Node24 dependencies:

```sh
node --import tsx ../../ops/arena-native-runtime-acceptance/roles.mjs
```

The endpoint is deliberately fixed to the existing disposable synthetic database `127.0.0.1:55441/arena`. The test refuses changed source bytes against the frozen modern overlay manifest. It extracts only the existing local fixture setup prefixes, then invokes the actual current intake, disclosure, reader, provider, adjudication, capacity, client and execution classes using eight temporary LOGIN roles. Each connection proves `session_user=current_user`, no owner status, no role membership and no elevated PostgreSQL capability. Setup and final teardown use only the disposable database owner. The test removes its eight roles, schema and generated fixture modules, and verifies zero remaining roles/schema.

Thirteen groups passed on PostgreSQL16.15. Actual SQL covers row locks, invoker-trigger dependencies, private inputs/history, modern artwork queue/cache, provider reservations and known-response recovery, adjudication, signed bytes/nonces/receipt history, opening observations, client receipt recovery, publication/capacity invalidation and source-selector refusal. Fifteen protected trigger functions remain unavailable through direct EXECUTE while their real triggers execute successfully. Negative checks deny DDL, selector/migration writes, legacy public projections, inappropriate table/column updates, durable-history deletion and private prompt access for the sampler/tracker.

The historical grant set alone fails with SQLSTATE42501 on the restored modern artwork queue, cached media artwork, lobby identity accounting, sampler observation/upsert and publication cache invalidation. The test records those failures before adding only the finite delta in `current-grant-delta.sql.review`; the corrected paths then pass. The inert review file uses deliberately undeployed placeholder names. It does not authorize production grants or identify production roles.

All HTTP/provider and broadcast effects use the retained in-process synthetic fixtures. An unexpected real `fetch` throws, and the final counter must be zero. The public native observations are the existing test fixtures. This proves operational DML under nonowner roles; it does not attest production ACLs, credential-mounted constructors, a live provider, a genuine Ponder RPC/reorg lifecycle or the isolated rollback source's read grants. The separate real native read-model SQL proof covers canonical database reads. Actual production role OIDs/default ACLs and the genuine Ponder lifecycle remain separate acceptance work.

Evidence is written to `docs/unified-indexer/arena-current-native-role-local-acceptance-2026-10-22.json`. The public log contains only case names and synthetic-test results. No production connection, private environment file, provider key, service or Git state is accessed or changed.
