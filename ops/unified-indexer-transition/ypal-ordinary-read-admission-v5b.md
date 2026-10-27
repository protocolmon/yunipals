V5b equivalent logical reads
===========================

This new operator copies only the existing seven roles' owner-granted V4 logical
USAGE/SELECT/EXECUTE edges authenticated by the actual c2da READ143 receipt onto
same-named, same-signature V5 objects authenticated by the actual V5 creator.
The count is computed from the protected catalogs; it is not another143 grant.
No native or control reads are granted again. No role, LOGIN, password, DML,
selector, service or application changes are included.

The old c2da postgraph is immutable ancestry. The new catalog must match that
complete graph after removing only V5 objects; therefore a racing V4 permission
change cannot become the accepted baseline. Fresh V5 ACLs must be owner-only,
including column ACLs. All-grantee column ACLs and all unrelated role/object/ACL
state are preserved through the original guarded rollback, single COMMIT,
unknown-ACK reconciliation and inverse bodies. JIT is disabled in the existing
local peer SQL session; existing timeouts and capability-free peer remain.

Current source qualification uses the acknowledged ordinary standalone epoch via
5a1, separately from immutable read acknowledgements. The source-independent
acknowledgement() and validate_catalog_current() exports never qualify a current
writer. The latter requires the complete current postgraph and becomes stale if
a later owner adds acknowledged cache/LOGIN grants; later composition must
explicitly account for those deltas. This owner does not qualify consumers.

Predecessor and runtime correction
----------------------------------

Published adadc7f8 was actually staged and its first plan preflight refused
before plan capture or grants: 5a1 catalog bridge expected operatorSha256 while
the genuine c2da leaf returns producerSha256. The failed phase and all old bytes
remain unchanged. This new producer has its own v5b FORMAT/BASE/INPUT_BASE and
calls/authenticates the actual c2da catalog-only output directly, without aliases.
Its genuine producer/leaf integration regression checks that exact return shape.
The SQL/catalog/scope/commit/inverse bodies are unchanged.

Execution (root owns host staging and all effects)
------------------------------------------------

Default invocation is static. Install the exact public closure and create only
the new root0700 INPUT_BASE directory. Copy the reviewed input exclusively as
root0600 input.json. Its four fields bind ordinary result/input, baseline READ143
result and actual V5 created receipt. No future acknowledgement may be invented.

Run the new source with `--context-input INPUT_SHA`. It exports only aggregate
counts/hashes and saves the raw proposal privately under INPUT_BASE/observations.
Use the returned planReviewHash with `--capture-plan PLAN_REVIEW_HASH` and the
same context input. Then use its planSha256 as `--plan-sha PLAN_SHA` for review.

Run `--rehearse REVIEW_HASH` with that same plan/context. This performs the exact
new logical GRANT statements inside ROLLBACK, verifies the complete postgraph,
and proves the complete original catalog was restored. Review again and obtain
the separate exact SQL authorization digest from canonical encoded
`host.helpers.statements(host.plan)` using the new namespace/Host and protected
plan. The reviewed actual statement list is the only authorization domain.

Only after actual review and rollback qualification, run
`--commit REVIEW_HASH SQL_AUTH_SHA`. This creates a durable exclusive intent
before the one COMMIT. An uncertain outcome permits only `--reconcile` with the
actual intent digest; never resend COMMIT or remove/rewrite a journal. A foreign
or partial graph refuses. The result records baseline143 separately and
nativeRegrants:0. `acknowledgement(ACTUAL_RESULT_SHA)` is immutable and source-free;
`validate_catalog_current(ACTUAL_RESULT_SHA)` rechecks the exact current graph.
The original inverse-review/inverse/reconcile-inverse protocol remains available
only for this owned delta and its actual source/consumer phase.

Actual production input reference
--------------------------------

V5 created receipt: 5acb7de8be040d76458d2a8e2c0792f33df89a9f790e94377c177cd4f75d7337.
Root reports actual schemaOID77370532. Product derives that OID from the creator
receipt and never guesses it. The source uses immutable public code pins; the
finite preparation lists their exact bytes. Raw catalogs remain host-private.

Local validation
----------------

`python3 -I -B ops/unified-indexer-transition/ypal-ordinary-read-admission-v5b.test.py`
runs nine isolated controls including reused actual namespace plan/commit,
unknown ACK/no-repeat, inverse, old-graph CAS, all-column preservation and effective
read/write negatives. Its synthetic143 baseline contains71 logical reads; that
is a fixture fact, not a production count. Disposable PostgreSQL review separately
uses real V5 DDL and INVOKER privileges. No production admission is claimed by
source tests or this document.
