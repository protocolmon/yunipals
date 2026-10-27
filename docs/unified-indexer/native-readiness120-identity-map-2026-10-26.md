# Native metadata readiness: 120-second policy identity map

The user explicitly authorized changing the native readiness and migration
approval criteria from 90 to 120 seconds. This note maps the narrow source and
identity consequences. It records source inspection and five offline controls;
it does not record a database change, runtime qualification, or successful
cache handoff. Split-preparation and performance work are paused.

## Official policy and identities

The active policy expression is the single `interval '90 seconds'` in
[`base-metadata-views.ts`](../../apps/yunipals-indexer/lib/unified/base-metadata-views.ts:77).
Only its duration changes to `120 seconds`. The surrounding release, read
identity, native ingestion mode, ready state, exact frontier, approved on-chain
implementation, no-future timestamp, checked block bound, and canonical checked
hash predicates remain.

The worker's separate `60 seconds` quiet-block reuse condition in
[`native-base.ts`](../../apps/yunipals-indexer/lib/metadata/native-base.ts:208)
does not change. The approved implementation in `base-implementation.ts` is
the on-chain address `0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca`, not a digest
of this SQL function. A database function amendment therefore does not itself
require changing that address, rebuilding the metadata worker, restarting its
actor, or resetting the approval timestamp.

[`ownership-views.ts`](../../apps/yunipals-indexer/lib/unified/ownership-views.ts:67)
currently derives the read identity from exactly
`{version: 5, releaseId, configs, nativeBase}`. The function body and TTL are not
inputs. Changing the literal alone therefore leaves the existing V5 marker
`0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab`
unchanged; that marker alone cannot authenticate the new policy.

The source manifest describes chain sources and is likewise unchanged by this
literal. The public TypeScript file hash and the recorded official SQL statement
hash change. The frozen V5 preparation pins the original file and its original
nineteen owner statements; it must remain historical and cannot be regenerated
in place as if it described the new semantics. Merely editing repository source
does not amend the existing PostgreSQL function: the official creator's existing
schema branch checks object completeness and returns without replacing bodies.

## Three concrete current-proof boundaries

1. **Created-object identity.**
   [`ypal-ordinary-readview-v5.py:data_current`](../../ops/unified-indexer-transition/ypal-ordinary-readview-v5.py:123)
   compares the full current target with the saved created target, excluding
   permissions only. The function's complete `pg_get_functiondef` result is
   included. An in-place TTL amendment correctly makes this old proof refuse.

2. **Full admitted READ graph.**
   [`ypal-ordinary-read-catalog-v5.sql`](../../ops/unified-indexer-transition/ypal-ordinary-read-catalog-v5.sql:13)
   includes `md5(pg_get_functiondef(...))` for ownership functions. The actual
   `acl_catalog` projection excludes only dynamic active-release/adoption
   fields, so it retains this digest. Both admitted-catalog current validation
   and the provider's `current_reads` reject a changed body against their
   historical expected graph. The complete ACL, role, object, and all-column
   graph remains mandatory; a body-only change is not an ACL exception.

3. **Metadata actor construction.**
   Owner3's actor-only path strips whole Source refresh callbacks, but its
   [`Context.__init__`](../../ops/unified-indexer-transition/ypal-native-metadata-approval-epoch-v1.py:191)
   first invokes the genuine handover's `metadata_primitives`. That function
   calls the old creator's `data_current` before actor initialization.
   Consequently unchanged Owner3/observer17a current calls will also refuse
   after the amendment. This is a constructor/current-proof dependency, not a
   reason to restart the actual metadata worker or rewrite its accepted ACK.

The active Source6 inherits Source5's
[`Authority._read_current`](../../ops/unified-indexer-transition/ypal-ordinary-source-authority-v5.py:544).
It independently captures the saved target identity, compares a fresh complete
target, and then executes the full admitted catalog validator. Both expected
target and expected graph require an explicit policy-aware successor route.

## Minimal reviewable migration route

Use a distinct owned policy amendment over the existing active V5 schema. Its
own input, producer, source manifest, review, intent, transaction identity, and
receipt must be separate from the historical creator/admission/metadata ACKs.
Before and after must bind the full function definition, function OID, owner,
security mode, configuration, ACLs, schema marker, all other target objects, and
the full READ/all-column catalog. The only allowed catalog changes are the
one function definition and its corresponding recorded definition digest.

The SQL mutation should replace that exact function in one bounded transaction,
with a complete original-body compare before replacement and exact expected-body
compare afterward. It must not drop/recreate the function, edit rows, refresh
approvals, alter the read marker, grant permissions, select a generation, change
private configuration, or manage services. An owned inverse must compare the
actual amended state and restore the exact original definition under its own
journal, rather than relabeling a historical inverse receipt.

The policy's new acknowledgement/current APIs then supply the explicitly
authenticated expected target and expected catalog to new Source, provider,
metadata-primitives, and actor-observer adapters. These adapters preserve all
other original code and live checks. Their results must name the policy
producer/receipt, preserve the original metadata actor and raw Owner3 ACK as
ancestry, and report that the old immutable-body current proof was not passed.
They must not patch frozen module globals or substitute an acknowledged actor
for the actual actor.

The migration authority needs its own explicit 120-second successor and fresh
qualification; its final ACK reserve stays five seconds. Unrelated command,
query, heartbeat, provider, and scheduling timeouts do not change. Historical
90-second failures and receipts remain unchanged. No old timing qualification
becomes a 120-second qualification merely because the new policy is installed.

Creating a new read schema/version would also be honest, but it changes read
identity, selectors, native approval adoption, and associated private/runtime
ancestry. The owned policy amendment is the narrower route for the requested
duration-only change, subject to actual review and rehearsal.

## Offline evidence and limits

`/tmp/ypal-native-approval120-identity-map-source.test.py` passed five controls.
They checked the original single SQL literal and saved statement, reconstructed
the actual V5 digest inputs, executed both original identity projections,
executed the original full-catalog graph projection, and exercised the original
`metadata_primitives` body with explicit fixture I/O to demonstrate the strict
creator-current dependency before actor setup. The tests made no Host/Source
constructor, database, service, network, or provider calls. They establish the
source dependencies above; they do not establish a migration result or current
production authority.
