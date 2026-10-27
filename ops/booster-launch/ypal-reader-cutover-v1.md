# Fresh YPAL reader and artwork queue cutover

This owner consumes the actual source-start receipt before admitting reads or
switching readers. No future source receipt, namespace OID, table OID or ready
witness is supplied by this preparation. The frozen source producer is
`ypal-source-start-v1.py` **eef6040deb5240c2f0ea43229882ca01921981f2c1a9224ef4b55da350a87b05**.
It must be staged at the existing protected backend input directory. Its actual
`/var/backups/yunipals-ypal-source-start-v1-20261023/result.json` hash is an explicit
operator argument. Its full `validate_current` must pass for every forward
phase; this includes its finite approved free canonical-header reads. There is
no native-readiness exception.

The owner reuses actual preparation producer73a/build8e88 and its protected
reader candidate files. It preserves HTTP bundle41fe/unit5ae, queue bundlee2b,
existing collector role73187672 with connection limit6, the existing private
DB environment, base units, timer definition/enablement, approved artwork and
all old-schema data. It does not stop/start an indexer, modify a proxy, create a
role, change LOGIN/passwords/connection limits or execute row writes.

## Review, exact rollback, admission

After root stages the reviewed source and the source owner has an actual ready
result, pass its real hash to each command:

```sh
python3 -I -B /var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py \
  --source-start-sha <actual-source-result-sha>
```

Default review reads the real native schema/OIDs and the complete collector
catalog. It requires exactly ten managed fresh tables, the ten original tables
still readable, their retained source owner, no collector writes/schema CREATE,
no memberships, and the unchanged existing LOGIN/limit6/no-password role. It
binds every schema/table ACL, including PUBLIC/grantor/grant-option entries, and
the collector's entire direct schema/relation/function/database/default-ACL
edge graph. Native OIDs must match the acknowledged source receipt.

`--rehearse <actual-default-review-hash>` creates one protected evidence directory
and executes exact generated GRANT SQL inside a ROLLBACK transaction. Ten SELECTs
are proposed; schema USAGE is added only if it is actually missing. No default
privileges, writes, grants with grant option or other roles are admitted. SQL
checks exact before/after catalogs within the transaction. The output records
real before/after graphs, transaction hash, unchanged old ten reads and no LOGIN
change. Existing/unknown rehearsal prefixes are not overwritten or rerun.

Review the concrete SQL/result before using `--admit <actual-rehearsal-json-sha>`.
Admission rechecks the full catalog, original API actor/static/private inputs,
source receipt and independent OG/shared-BNB/proxy packet. It writes an exclusive
COMMIT intent before sending SQL. Success requires the explicit SQL return and
fresh exact after graph. An absent ACK is not inferred from a matching graph;
`--inspect` reports the prefix, and SQL is never reissued automatically.

## Separate reader switch

`--review-switch` requires the acknowledged admission, same original readers,
actual source readiness and unchanged artifacts/private inputs. Apply only the
fresh returned hash with `--switch <actual-switch-review-hash>` after root review.

The switch stops the existing timer, drains its bounded one-shot worker, and
stops only the exact reviewed HTTP actor. It publishes one public environment
file and two fixed drop-ins exclusively, with a durable staging inode recorded
before each no-overwrite hard link. It never rewrites a base unit or private env.
It reloads the manager and starts the same API program, checking actual UID/GID,
argv/cgroup/start identity and the selected fresh public environment internally.
No private environment bytes are exported.

Local and public readiness, fresh collection/engine identities, exactly type1
at1YPAL, global/recent pages and approved standard81 artwork must return200.
Only read observations are retried, for at most20 seconds. A fresh namespace has
no token1 yet, so NFT birth metadata is not falsely claimed tested on an absent
NFT; the journal SELECT is included in the ten effective reads. The existing
queue program then runs once. Its genuine post-start journal event must report
`skipped:false` with coverage at least the observed native boundary. Only then
is the original enabled five-second schedule resumed. The result remains bound
to source/admission receipts and every publication inode. Root must separately
verify/promote the frontend after this real API acceptance.

## Inspection and owned inverse

`--inspect` is read-only and never promotes an unknown prefix to success.
`--inverse <actual-result-sha>` inverses a completed switch. For an interrupted
switch, the explicit reference is the protected `switch-review.json` hash.
Publication ownership is recovered only from prewritten exact inode/hash
records, including a lost hard-link ACK. A new running HTTP process is stoppable
only under its own exact static/environment/start intent; an unknown actor is
refused. No indexer is stopped or restarted.

The inverse restores the original API/queue definitions/configuration and their
original readyz collection/engine, then removes only this admission's exact ten
reads and any newly added schema USAGE. The old source is still stopped at this
point, so an honest503 with the correct original identity is accepted. The
separate source owner's inverse follows afterward. A fresh source that is
terminal uses the frozen `validate_owned` path. For the exact acknowledged
active source that has lost readiness, this reader inverse alone composes the
frozen owner's actor/unit/boot/catalog/session guards and returns explicit
`ready:false`, `readerInverseOnly:true`; it cannot authorize forward reads or
source actions. This avoids a reader/source rollback ordering deadlock.

If admission succeeded but switching never began, `--inverse <admission-json-sha>`
reverses only the read delta while preserving untouched readers. Existing inverse
intents are not automatically retried. Unknown SQL ACKs and interrupted inverse
ACKs require inspection/manual reconciliation; no catalog state alone is treated
as proof of a committed transaction. All protected evidence is retained.

## Local verification

```sh
python3 -I -B ops/booster-launch/ypal-reader-cutover-v1-test.py
node ops/booster-launch/ypal-reader-cutover-v1-postgres-test.mjs
```

Fifteen offline controls cover exact source interface, role/table/ACL drift,
readiness, private-file drift before commands, owned/foreign publication inodes,
lost publication ACK, completed/partial API-start inverse, and the inverse-only
active-but-not-ready case. Seven actual disposable PostgreSQL16 groups execute
real generated rollback/COMMIT/inverse SQL against twenty tables, check negative
write permissions and reject role/extra-ACL drift. No production action or actual
source-result qualification is claimed by these tests.
