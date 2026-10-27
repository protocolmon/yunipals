# Fresh combined-source cache guard transition

This catalog component targets the YPAL combined release and uses the unchanged
official `installReadCache` implementation. The earlier
`consumer-v4-cache-guard-transition.mjs` remains preserved for its historical
source. The component exports `capture`, `guardSql`, `rehearse`, `apply` and
`inverse`; it has no executable production entry point.

Its fixed binding is physical schema `unified_ypal_20261023_v1`, read schema
`yunipals_ownership_4e77f52b_v4`, release `4e77f52b…` and read identity
`cac869bf…`. A result from another binding is refused. Guard acceptance requires
exactly 35 relation mappings and exactly the four named collection epochs.
Mappings bind actual relation OIDs, enabled named triggers and their target
function OIDs. Trigger catalog proofs retain definitions and enabled states.

The captured scope includes both combined namespaces, the legacy ownership
tables and the existing metadata/cache relations. Snapshots bind table OIDs,
owners, columns/indexes, table and column permissions, the two cache functions,
known trigger definitions, guard mappings and epochs. Keep actual snapshots and
receipts in protected local storage.

## Transaction and inverse

Use one dedicated database client for every call. A short transaction locks the
finite relation set, captures current epochs, runs the official installer, then
checks the complete result. `rehearse` always rolls back. `apply` requires its
successful rehearsal, exact current catalog and fixed binding before committing.
The existing tables, owners, function identities and permissions are retained;
the only permitted additional permissions are finite table SELECTs on the four
cache tables, copied by the official installer from existing search readers.

Column permissions are captured separately. PostgreSQL's table-level
`REVOKE SELECT` also removes column SELECTs for that grantee. A transition that
would overlap such pre-existing column rights is refused during rehearsal;
that case needs a separately reviewed inverse. Current foreign column/table
permission changes also prevent an inverse from proceeding.

The inverse restores the saved function/trigger definitions and guard mappings,
revokes only the owned finite SELECT additions, and advances the current epoch
once. It preserves intervening invalidations and application/source/cache data.
Exact catalog checks prevent repeating an inverse or replacing foreign changes.

## Required caller

A production execution owner still must bind:

- Actual source, created read-view and READ-admission acknowledgements, plus
  fresh canonical coverage and metadata provenance.
- A genuinely new accepted generation carrying this release/read identity.
- The exact cache writer drain, definitions, credentials and activation paths,
  with terminal process/session proof and its owned inverse.
- The installed official source hashes and selected configuration, one pinned
  database session, exact rehearsal and a fresh finite grant review.
- Durable single-attempt SQL intent, unknown-acknowledgement inspection and
  explicit recovery. An uncertain COMMIT must be inspected before continuation.
- The resulting finite permission delta in later consumer preservation checks.

This component supplies the catalog transaction. Worker selection, generation
execution and the final coordinated rollback remain separate acceptance work.

## Verification

From `apps/yunipals-indexer`, using its existing dependencies:

```sh
node --import tsx ../../ops/unified-indexer-transition/ypal-cache-guard-transition-v1-postgres.test.mjs
```

The test verifies the existing disposable PostgreSQL 16 container and creates
unique synthetic state. Fourteen groups exercise the real official installer,
all 35 mappings, wrong/stale bindings, exact rollback and commit, real truncate
invalidation, extra or replaced collection epochs, table/column permission
refusal, preserved prior UPDATE rights, monotonic inverse, duplicate refusal
and the official direct-query fallback. Five official source files are checked
against the retained implementation hashes. The fixture cleans up its database
and role and makes no production or provider requests.
