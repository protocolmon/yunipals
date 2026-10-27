# Completed reader inverse: source-independent validation

`ypal-native-inverse-leaf-v1.py` validates an actual completed inverse from the
frozen restored-source coordinator. It performs only protected-file, catalog,
process, boot, read-only SQL and existing local HTTP checks. It cannot execute
an inverse, rerun SQL, request a service action, choose a source or publish a
generation. Its default CLI is static.

The helper is pinned to coordinator `3e133cada…` and external manifest
`15998fac…`. Those files and all their predecessors remain unchanged. The
managed caller must separately pin this new helper and its actual inverse
receipt; a raw `restored: true` field is insufficient. There is no acceptance of
arbitrary receipt paths, context factories or future acknowledgements.

The exact API is:

```python
validate_inverse_leaf(result_sha, manifest_sha)
```

`result_sha` authenticates the fixed coordinator
`/var/backups/yunipals-ypal-native-cutover-v2-20261024/inverse-result.json`.
`manifest_sha` must equal the frozen `15998fac…` manifest. Both are actual
references, never guessed values. The helper revalidates the operation/inverse
intent and completion hashes, cache4 and two-LOGIN recovery, committed own XIDs,
global 103/capsule aggregates, metadata recovery, current original reader/cache
actors, private inputs and boot inodes. It also runs the existing real legacy
serving acceptance, including all retained features and Solana availability.
Unknown, partial, contradictory or foreign records refuse without reexecution.

A new completed-inverse context supplies only graph authority. It validates the
fresh 143-read admission with the new graph-only READ validator, including all
grantees' column ACLs, and checks the exact restored NOLOGIN bits, removed cache4
reads and original cache guard. The READ helper's dynamic `activeRelease` and
`nativeMetadataAdoptions` values are excluded from ACL comparison by its existing
definition; actual restored RPC metadata, blocked native approval, private
configuration and monotonic cursor are qualified independently by the frozen
metadata recovery validator. No old whole validator is reported passed.

This context never calls the active994 or fbb active/terminal source predicates.
The observer acknowledgement is immutable activation ancestry only. A managed
owner can therefore call this helper before and after its separately owned
standalone source restart, provided the physical/logical dataset and consumer
facts remain exact. Feature8 or any other independently owned additions must
already have been reversed before the full restored143 graph can pass.

The result separates stable identity from live observations:

- `binding` and `bindingSha256` authenticate the exact recovery records, current
  reader/cache/metadata actors and boots, catalog/column/guard identity and
  restored global 103/capsule context. A caller compares this around its own
  source transition.
- `observation` contains the current legacy HTTP proof and metadata cursor.
  Legitimate cursor and source heartbeat progress is not included in the stable
  binding. Metadata may advance only under its existing acknowledged original
  start and frozen monotonic recovery checks.

`sourceActorQualified`, `currentWriterQualified`, `financialAuthorityQualified`
and `currentReadinessQualified` remain false. The caller owns the then-current
writer, source, free/financial policy, canonical coverage and readiness checks.
This helper does not replace the coordinator's forward or inverse execution
gates and cannot qualify a new generation or a replaced consumer invocation.

Future operational use, after separate review and actual completed recovery:

```sh
python3 -I -B "$OPS/ypal-native-inverse-leaf-v1.py" \
  --inverse-sha "$ACTUAL_INVERSE_SHA" --manifest-sha "$EXACT_MANIFEST_SHA"
```

Keep detailed runtime output root-private. Public evidence should contain only
aggregate hashes, counts and explicit scope. No host execution or production
inverse has been performed by this source preparation.

Local controls:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-native-inverse-leaf-v1.test.py
```

The 13 controls use protected temporary files and actual reused coordinator/READ
methods. They cover mixed recovery records, partial success flags, full column
ACL drift, remaining LOGIN/cache reads, stale guards, current reader/private/
start/boot facts, metadata SQL acknowledgement/reconciliation, changed inodes
and unknown XIDs. SQL and service observations are explicit local fixtures;
these tests do not claim an actual host recovery or manufacture an actual ACK.
