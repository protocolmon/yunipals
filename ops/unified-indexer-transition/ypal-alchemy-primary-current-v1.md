# Alchemy current quiet and deadline leaves

This is a read-only leaf for the separate source-switch and financial owners. It
imports no financial owner and never sends a systemd mutation, provider request,
or SQL write. The default CLI reports source-only status and performs no host
qualification. The actual lifecycle operator, installed units, protected operation,
financial plan/result and admission link must exist before the runtime exports can
qualify anything. This packet alone authorizes no paid deployment or allowance.

Run the local controls with:

```
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-primary-current-v1.test.py
node ops/unified-indexer-transition/ypal-alchemy-primary-current-v1.postgres.test.mjs
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-primary-current-v1.py
```

The fixed production source manifest binds the actual lifecycle producer. The
operation is created **before** financial COMMIT. Its immutable identity includes
`operatorSha256`, `manifestSha256`, `planSha256`, `bootId`, and
`originalFreeRoutes`, with all four original `actor`, `definitions`, complete
ordered `environmentFiles`, `unitSecurity` and `activation` observations. The
operation must never be rewritten to insert a future financial receipt.

After an actual financial admission ACK, the lifecycle writes a separate exclusive
`financial-admission-link.json` under its fixed protected BASE. Its format is
`yunipals-alchemy-source-switch-v1-admission-link`; it binds the same operator,
manifest, operation and plan hashes plus the actual `financialResultSha256`.
The leaf checks that the actual admitted financial result matches this plan. The
financial caller separately authenticates its own prepared/intent/XID/COMMIT
chain; this leaf deliberately does not recursively grant financial authority.

`validate_paid_quiet(quiet_result_sha, financial_result_sha)` authenticates the
fixed `paid-quiet.json`, operation, admission link and all four current free
routes. Quiet binds `operationSha256`, `admissionLinkSha256`, `planSha256`, actual
financial result, lifecycle/manifest and `routes`. Each route has an explicit mode:

- `never-paid`: all nine owned per-chain journal names are absent, and the full
  current free actor, definition bytes/inodes, private file chain, loaded security
  and activation links equal the original operation. A committed financial
  admission does not imply that this route ever started paid work.
- `prepared-stopped`: the actual paid-definition intent preceded the stop, both
  paid-start journals remain absent, and the actual stop intent says
  `startNeverAttempted:true`, `processes:[]`, `ownedBackends:[]`. Actual once-only
  free-start intent and result bind the current new free actor. This handles
  interruption after the original free unit was stopped but before a paid start.
- `paid-stopped`: the stop intent links the actual admitted paid-start intent and
  positive captured paid process identities, or the explicit lost-start terminal scan described below. Every recorded PID/start tuple must
  be gone even if it escaped its cgroup; every recorded budget backend PID/start
  tuple must be gone. Actual free-start intent/result and a bounded monotonic
  start window qualify the new free actor. A missing start ACK alone never proves
  that no paid process ran.

The exact nine journal suffixes are `paid-definition-intent`,
`paid-definition-installed`, `paid-start-intent`, `paid-started`, `paid-stop-intent`,
`paid-stopped`, `free-definition-restored`, `free-start-intent`, `free-started`.
Never-paid refuses even a dangling intent or symlink at any such path. Prepared
and stopped receipts bind same-boot, same-operation journals. Original free
unit-definition inodes must be parked/restored rather than replaced with a merely
byte-equal file. Staged private inputs or public artifacts outside this journal
set do not themselves prove a paid start.

`unit_security(m,unit)` and `activation(m,unit)` are exposed so the lifecycle can
record the same fixed manager fields, typed no-job property, enabled state and
root-owned boot-link inode/target packet used by this leaf. Current free program,
NoNewPrivs=1 and all five zero capability masks are checked independently of the
saved actor. `/metrics` must show `free_first`, integer zero paid calls and all
five actual fallback flags strictly false. Healthy FREE requests may remain
active or queued: integer counts must be nonnegative, active work must not exceed
the reported upstream limit (1 through64), and queued work must not exceed the
actual source queue limit64. This is a paid-quiet leaf; the lifecycle separately
drains owned paid processes and budget sessions under its source lock.
A final four-route actor/input/definition/security/activation
CAS follows the per-route metrics reads. Only matched recorded budget backend
identities must drain; unrelated role connections are not globally required zero.
Both lifecycle capture and this leaf project `backend_start::text` before JSON
serialization. Native timestamp JSON uses a `T` separator while the text cast
uses a space, so mixing those projections can miss an identical live backend.
The disposable PG16 test reproduces that distinction on its own still-live
connection, demonstrates the former comparison miss, and executes the actual
fixed leaf to refuse the matching text PID/start tuple. It adapts only the role
predicate to that disposable client; it reads no production backend.

`validate_deadline_prepared(plan_sha, deadline_receipt_sha)` can run before any
financial admission. The fixed `deadline-prepared.json` binds that exact operation
and plan plus the four installed close/UTC service/timer definitions and timer
boot links. It checks literal commands and calendar times, manager-loaded paths
with no drop-ins, typed Unit Job=[0,"/"], dormant root oneshot services, NoNewPrivileges, Restart=no,
KillMode=control-group and typed TimeoutStartUSec=900000000 / TimeoutStopUSec=90000000.
RuntimeMaxSec is not accepted as a oneshot startup timeout. MainPID is queried
only for services: the actual production timer show omitted this Service-only
property, so timers are checked through their six observed Unit fields and typed
Timer due/Unit job properties. Both timers must be
active/enabled with exact typed NextElapseUSecRealtime and persistent, zero-jitter,
1us-accuracy calendar definitions. Financial child UID/capability dropping remains
the separately pinned financial owner's responsibility; root deadline services
retain only the capabilities needed by their reviewed lifecycle child commands.

Lost paid-start ACK: an empty captured process list is accepted only when the
authenticated same-operation paid stop intent explicitly sets
`terminalScanRequired:true` and still links the actual paid-start intent, definition
intent and admission link. `assert_no_paid_proxy_processes()` derives the fixed
RPC account from `pwd`, performs two bounded full `/proc` UID inventories, and
checks stat/start identity plus bounded argv only for that same account. Any
reference to the fixed paid artifact refuses even outside an owned cgroup.
Unknown empty or unterminated live command data, UID ambiguity, scan errors or
same-account inventory drift refuse. Vanished PIDs cannot dispatch; empty argv
is allowed only for kernel-reported nonactive zombie/dead states. No environment
or foreign argv is read or exported. Initial and final terminal scans surround
the route checks; the final four-free-actor/input CAS follows those scans. Recorded
paid backend tuples must still drain, and the lifecycle separately owns complete
role/session attribution for any otherwise unrecorded interrupted prefix. An absent
ACK or empty cgroup alone never becomes never-paid. All runtime receipts and private file contents remain host-root
private; successful exports contain only bounded hashes/modes and authority flags.
Both exports keep `sourceActorQualified:false`; neither replaces source, financial,
canonical, readiness or complete lifecycle acceptance.

This same-v1 correction supersedes published source552bd85d, which root confirmed
was never deployed and had no actual operation or financial receipts. That
historical Git version remains preserved. The current source-only validation is
32 focused Python controls plus one genuine read-only disposable PG16 group;
actual host qualification and financial admission remain unclaimed.
