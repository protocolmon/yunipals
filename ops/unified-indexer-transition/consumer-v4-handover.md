> Current operator selection: use [consumer-current-handover.md](consumer-current-handover.md). This retained v4 note supplies generation/cache details; its owner-v4, preview-v4 and install-v5 commands are historical. Production reader admission uses the qualified marketplace acknowledgement entry with owner-v6, preview-v6 and install-v7.

The v4 consumer path uses the already installed `41e5` runtime, the acknowledged
`bc540` main API correction, and the actual v4 metadata views. It does not replace
the Ponder source, move its checkpoint, or publish `active_release`. Older
operators, views, candidate files and service definitions remain rollback inputs.

## Current evidence and executable steps

The metadata owner committed v4 at receipt
`ad4a5004e84a9aae47e301c50af1268b88e03b8bf3c812b4096c89390a0ab24c`.
The 17 staged candidates are in
`/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022`, receipt
`be0e6ec9f39d9b967a5395a7955496be801a04dc26cf90f3ce7173941e8591a0`.
Actual catalog preflight passed on 22 October: four original consumer role OIDs,
the retained operational ACL graph, additive v4 grants, and the exact v4
relation/function digest `5cfae260c056a73e2f195586bc69eae651a71e7f4d4e8e191b8aee14e0db350c`.
The digest was compiled from the pinned official DDL in disposable PostgreSQL16,
then matched on production. These facts do not establish current source readiness.

The native staking service is installed dormant, receipt
`af586eaa5958822ed8f481563755ed5f1e9956e814779c9e86fc0c8de6a3d145`.
Before its first verification, drain and disable the separate enabled legacy
`yunipals-islands-staking.service` and any owning schedule. Admit the existing
dedicated peer login using its prepared bounded runtime step, run one successful
verification, then admit the five-minute timer. Do not start two verification
writers. Its candidate changed only the read schema and read identity; its
previous artifact and credentials were retained.

The remaining ordered transition is:

1. Finish post-repair source acceptance and a fresh fixed-boundary witness. Drain
   the old Base metadata/publication writers; use the v4 staged
   `native-recovery.sh native-adopt`, `native-provenance`, and `native-refresh`
   with their existing bounded owner/provenance rules. Install the corrected
   retained metadata candidate and verify actual readiness.
2. Drain the legacy leaderboard generation writer, run the bounded official v4
   refresh below, and retain its actual new generation identity. Do not relabel
   generation103: its observed ownership release and read identity were null.
3. Rehearse, then execute the existing transactional read-cache migration with
   v4 selectors after draining the legacy cache writer. At 10:51 UTC production
   still had 35 **legacy** guard mappings. `native-adopt` does not install these
   guards. This is a required owner operation, not part of a consumer read grant.
4. Run the three positive v4 API previews sequentially, with the dedicated roles
   returned to NOLOGIN afterward. Main uses its existing direct-query fallback
   while the new cache is empty; no cache feature flag is disabled.
5. Admit the existing finite visibility and cache DML slices using the new main
   preview. Do both before permanent API admission, since these owner operations
   require the four roles to remain dormant.
6. Admit cache first using install-v5, allowing the real worker to build its new
   cache. Its ready-generation and exact native-guard preconditions replace the
   impossible requirement that an unstarted worker already have a fresh cache.
   Acknowledgment still requires actual current-generation cache freshness under
   the restricted role. Then admit main, collector and Islands one at a time
   with install-v5 and their corresponding positive preview receipts.
7. Recheck public retained routes, user collection/filter behavior, Solana,
   staking and transaction evidence. Final supervisor handover and old scanner
   retirement retain their separate source/lease/rollback procedure.

## Official generation refresh

`consumer-generation-v4-refresh.service.example` runs the unchanged official
`41e5/scripts/refresh-leaderboard.ts` once. It preserves the four ordered private
leaderboard files and appends the already acknowledged public v4 selector file.
The original script hash is
`5cbd508e9da46efd40a84a8809111111295a668676d04cff84170599c51a8fb2`.
No database URL, API credential or pool setting is substituted. The unit has no
install target, no restart policy, no capabilities, and a25-minute execution
ceiling. Its `ExecStartPre` invokes the official ownership, metadata and
projection-capacity checks in a read-only transaction; it checks v4 identity
before the official refresh can write. Its fixed monitor then launches the
unchanged refresh, which retains its normal locks, validation, repeatable-read
build and atomic generation publication.

Before execution, compare the current leaderboard invocation, definitions and
four ordered environment-file hashes against its retained stage. The original
retained helper's `snapshot('yunipals-leaderboard.service')` provides this check.
Verify its typed PassEnvironment/UnsetEnvironment remain empty. The actual
retained invocation1102bd4256164f73acb8ba2bb5494db3 has four public inline
settings: RARITY_READ_SOURCE=local, YUNIPALS_PROJECTION_MODE=generation,
PROJECTION_BACKUP_PEAK_BYTES=10000000000, PROJECTION_STORAGE_PATH=/.
`consumer-generation-v4-inline.env` reproduces those values **before** the four
original env files, preserving systemd precedence. The effective backup peak
is35GB because query-capacity.env overrides the10GB inline setting. If the
current inline names/values or any private file hash differ, reconcile them
explicitly before using this one-shot; do not omit them or put them after the
private files. Record and drain the exact
old generation writer, wait for its cgroup and PostgreSQL sessions to finish,
and keep it stopped until its retained v4 candidate is selected. Also ensure a
separate generation refresh is not already running.

After the public readiness script, capacity monitor and both public env files
are staged at the protected operations path,
and after the preceding checks and source/metadata readiness have passed, the
actual start commands are:

```sh
install -m 0644 /opt/yunipals-unified/operations/free-replay-20261020/consumer-generation-v4-refresh.service.example /run/systemd/system/yunipals-generation-v4-refresh.service
systemctl daemon-reload
systemctl start yunipals-generation-v4-refresh.service
```

Require a previously absent unit/file before the install command; do not
overwrite a prior attempt. Record its actual InvocationID/PID and exact unit
hash. Observe without restarting. The monitor requires an exclusive private systemd runtime directory, a full
25-minute no-backup schedule window, no active dump/restore process, and no
existing backend with its unique application name. On success require exit0,
an empty cgroup, the monitor result without a failure, no remaining owned
backend, and `consumer-generation-v4-proof-v1.generation_sql()` returning ready state,
the fixed release and v4 identity for the **current** generation. A timeout or
failed process is not publication evidence; inspect the official generation
state and retained private logs before any retry. API credentials stay on host.

The ordinary retained leaderboard candidate must eventually replace its old
writer so future generations also retain v4 identity. Do not resume the old
legacy-selector service after publishing the first v4 generation.


The measured22October root capacity was40,793,346,048bytes. The official next
build estimate was10,265,210,880bytes; its normal35GB backup-overlap allowance
plus25GB reserve would require70,265,210,880bytes. All projection tables write
to the root `pg_default` tablespace. The separate106GB-free volume does not
change those writes. Current103 and previous102 were the only nonretired
generations, so no failed/building candidate was eligible for pruning.

The one-shot `consumer-generation-v4-capacity.env` sets backup-overlap to0 only
for this monitored attempt and retains the25GB reserve and root storage check.
It never edits the live35GB configuration. Its preconditions must be observed
again at execution; old no-backup evidence does not authorize a later overlap.
The monitor checks root free space every second, aborts at30GB, and checks the
whole remaining backup schedule window every five seconds. It runs for at most
1470seconds, leaving30seconds before systemd's1500-second ceiling for cleanup.
WALmax16GiB is not a hard cap; startup capacity alone is insufficient.

At an abort the monitor first validates its actual systemd invocation and
terminates only same-login-role/database PostgreSQL sessions whose exact unique
application name and backend start time bind them to this attempt. It then
stops the owned Node child. Actual PostgreSQL16 testing proved the unchanged
worker Pool honors PGAPPNAME and a non-superuser can terminate its own session
without a pg_signal_backend grant. Killing Node alone is insufficient because
a long database query may continue after its client disconnects. The monitor
keeps private child logs, invocation/input hashes, disk minimum and cancellation
outcome in `/run/yunipals-generation-v4-refresh-20261022`; the directory is
preserved after exit. Capture those receipts before any reboot. No failed or
timed-out attempt is restarted automatically, and publication still requires
inspection of the official generation pointer and v4 identity.

## Native cache guard migration and worker bootstrap

The existing command is `41e5/scripts/migrate-read-cache.ts`, using its original
transactional `installReadCache` function with native v4 selectors. It installs
the canonical physical-source guard graph, preserves trigger checks, and
increments cache epochs. It also derives SELECT grants from current search
readers; the owner rehearsal must record the exact finite current grant effect.
Do not invoke a broad general schema migration.

Before committing, capture the current guard/epoch/trigger-function definitions
and ACLs, rehearse the same official statements inside an explicit ROLLBACK,
compare their exact effect, and prepare their exact inverse. Keep the old cache
and legacy API serving until the coordinated handover; an owner script must not
use a rollback rehearsal receipt as evidence of a committed migration. This
owner migration/rehearsal remains a required execution step; the actual legacy
inventory alone does not authorize claiming it complete.


The concrete source is `consumer-v4-cache-guard-transition.mjs`. Its `rehearse`
calls the pinned official `installReadCache` in a transaction with the original
1-second lock and60-second statement limits, verifies all35 native mappings,
captures the exact SELECT delta, rolls back, and proves catalog restoration.
It locks both old and new fixed source relations during the brief transaction
so epoch comparisons cannot race a source write. No generation or cache row is
inserted, deleted or rewritten. The same library's `apply` compares the current
catalog with the actual reviewed before state, calls the same official code,
and accepts only the exact reviewed native catalog and finite grant delta.

For the actual production rollback rehearsal, root can execute this one fixed
operator; it creates one exclusive private capture and returns only a bounded
public summary:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tmp/yunipals-production-known-hosts root@168.119.172.10 /usr/bin/python3 -I -B < /root/yunipals/ops/unified-indexer-transition/consumer-v4-cache-guards-rehearse.py
```

The helper embeds the reviewed library and native guard query, hashes the
installed41e5 cache installer, and executes as the existing postgres actor via
the primary Unix peer connection. It requires the actual legacy graph and
primary5432/data-directory/database context. Full definitions/ACLs stay in
`/var/backups/yunipals-consumer-v4-cache-guard-rehearsal-20261022/review.json`;
its returned hash binds the complete plan.120-second observation timeout does
not authorize a retry; reconcile the owned process and database state first.
This command always rolls back and does not commit the later owner migration.

The committed inverse requires the actual commit receipt and an unchanged owned
native catalog. It restores previous guard rows, trigger definitions/enabled
states, function definitions and only newly added SELECT privileges. It retains
all cache rows and **increments current epochs** once. Resetting saved old epoch
numbers after live source writes could incorrectly make a stale cache fresh.
Disposable PostgreSQL16 testing covered actual legacy35→native35 commit and
inverse, existing UPDATE grants, finite SELECT grants, intervening epoch writes,
stale-review refusal, second-inverse refusal, and untouched cache rows.

Install-v5 verifies the exact 35 native guard rows, current relation OIDs, enabled
row/truncate/projection triggers and four epochs before starting the existing
cache worker. It uses the previously admitted finite writes and original worker
entrypoint, with no synthetic cache rows or timeout override. The admission wait
has a 30-minute ceiling, polls every15 seconds, and records the actual unit and
process plus the official SQL result. Two observed `57014` failures or two
refresh failures return actionable failure evidence promptly. The worker only
logs the PostgreSQL code, so `57014` is reported as query cancellation; the
receipt does not falsely claim it proves a statement timeout.

The earlier recovered legacy build processed580,093 rows in179.1 seconds, using
a clone-only480-second statement override. It is timing context, not proof that
the production v4 worker's unchanged60-second SQL limit is sufficient. Qualify
the actual v4 workload when its source is ready; deterministic failures require
diagnosis, not repeated waiting or a relaxed freshness predicate.

On an admission timeout/failure, install-v5 retains the exact process and writes
`cache-wait-result.json`, whose hash is bound by its failed installation receipt.
There is no automatic restart or retry. Use the existing owned rollback command
below after reading the result; it refuses a changed/foreign invocation.

## Preview and final selection commands

The retained feature ACL result is:

```text
/var/backups/yunipals-consumer-operational-owner-v2-20261021/apply-88240e7ca035abcd1b641a690a64302ff6e02522a7f46f8880b3af382add8490/result.json
SHA256 1cb9e3648d263ccb35393fba973ebe4d7a764f3f1103f4f566711f2922ba172f
```

Every preview/install retains these artifact arguments:

```text
--artifact-file /var/tmp/yunipals-runtime-41e5b5fd-20261021/install-result.json
--artifact-sha 0093abc56f8942b552a601d2eea925af04ebb834f01dd57ea596deaa8ee2ca42
```

Use `consumer-operational-preview-v4.py --service main|collector|islands` with
`--run-id 20261022-v4-<service>`, the actual feature ACL file/hash above, and the
new post-repair `--witness-file/--witness-sha`. Main additionally requires the
actual protected `--action-file/--action-sha` fixture with **v4** read identity;
the original two action-read grants remain the unchanged defaults. Run without
`--apply`, then repeat with the exact returned `--apply <reviewHash>`. Each
successful result must have `positiveSelectedServing=true` and clean role
restoration. Old v3 results cannot qualify v4.

For each of `--phase visibility` and `--phase cache`, run
`consumer-operational-owner-v4.py --main-cache --previous-file <actual latest
ACL result> --previous-sha <its hash> --preview-file <new main preview result>
--preview-sha <its hash>`. Review first, then apply its exact review hash. Chain
the first new ACL result into the second; preserve the original feature receipt
ancestry. These operations do not enable logins or touch services.

Use `consumer-operational-install-v5.py --service cache|main|collector|islands`
with the artifact arguments, latest actual `--acl-file/--acl-sha` and matching
`--preview-file/--preview-sha`. Cache consumes the main preview. Review first,
then repeat with `--apply <reviewHash>`. Use v5 consistently for all four units
so each later admission can verify already-admitted roles from the same owned
receipt directory. There are no presently successful final-install receipts to
substitute for these future results.

Rollback is the same explicit inverse:
`consumer-operational-install-v5.py --rollback-file <its result.json>
--rollback-sha <actual hash>` plus retained artifact arguments; inspect its
review, then add `--apply <rollbackReviewHash>`. It restores exact saved private
inputs/definitions and the previous service, and returns only the owned role to
NOLOGIN. Derived generation/cache rollback, if needed, uses the separate saved
official generation/guard state; service rollback does not fabricate old data.

## Local checks

Nine focused v4 transition tests, three actual official cache-compiler tests,
the disposable PostgreSQL definition-digest fixture, four refresh-boundary
checks and the focused cache-bootstrap suite cover this delta. They do not
claim successful production generation, cache bootstrap or API admission.

```sh
python3 -B ops/unified-indexer-transition/consumer-operational-v4-test.py
python3 -B ops/unified-indexer-transition/consumer-generation-v4-proof-v1-test.py
python3 -B ops/unified-indexer-transition/consumer-cache-bootstrap-v5-test.py
node --experimental-vm-modules ops/unified-indexer-transition/consumer-generation-v4-refresh-test.mjs
python3 -B ops/unified-indexer-transition/consumer-generation-v4-capacity-watch-test.py
# From apps/yunipals-indexer, using its installed tsx and the existing local PG16:
node --import tsx /root/yunipals/ops/unified-indexer-transition/consumer-v4-cache-guards-postgres-test.mjs
node /root/yunipals/ops/unified-indexer-transition/consumer-generation-v4-capacity-postgres-test.mjs
```
