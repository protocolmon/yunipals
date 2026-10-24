# Scanner inventory gate

`scanner-inventory-gate-v1.py` inventories reviewed source and launch evidence.
It does not start, stop, deploy, disable or retire a scanner, read a database,
call a provider, change a permission or assert production single-ingestor
acceptance. The default CLI is static. Source preparation has not captured the
production host.

The finite repository baseline pins complete candidate bytes and exact literal
call/command evidence, with explicit classifications. It fails on a new, changed
or removed detected entrypoint, changed detection scope or unknown category.
It has no automatic rebaseline/allow-new option.

```sh
python3 -I -B ops/unified-indexer-transition/scanner-inventory-gate-v1.py \
  --repository /root/yunipals
python3 -I -B ops/unified-indexer-transition/scanner-inventory-gate-v1.test.py
```

The source roots are exactly `apps`, `packages`, `scripts`, `ops`, `.github`, and
root `package.json`. Executable TS/JS/Python/shell and deployment unit/config/YAML
files are scanned, together with package and PM2 ecosystem JSON. Generated
outputs, dependencies, vendor and frozen archive trees are excluded explicitly,
as are `apps/*/public` assets and non-package evidence/metadata JSON. Docs, data,
local runtime caches and archived sites are outside these roots. The gate,
tests and baseline itself are the three exact self-exclusions; their reviewed
finite package hashes authenticate them. The repository directory and every present declared source root require an
actual lstat directory, including refusal of broken root links. Declared
generated/dependency exclusions are pruned first; any remaining source symlink
directory or candidate file refuses instead of hiding its target. External
source target bytes are never read.

This boundary prevents public evidence/metadata JSON and future captures from
becoming accidental source-baseline inputs. Installed opaque bundles, generated
artifacts, private deployment inputs and running byte/dependency identities
remain independently qualified by their actual owners and host capture. The
baseline is a literal detector, not a complete TS/Python/shell call-graph proof:
computed/obfuscated method names, unknown APIs and indirectly supplied commands
can evade syntax discovery. A path hash does not prove absence of a hidden
cursor loop. New source roots or detection rules require explicit review.

The reviewed classifications have different operational meanings:

| Classification | Concrete source evidence | Required treatment |
| --- | --- | --- |
| Shared Ponder | registered `ponder.config.ts`, shared launcher and unit templates | Only the separately accepted managed epoch may own common EVM ingestion. Historical launch code is not a current runtime ACK. |
| Shared Solana | `lib/solana/worker.ts` and `das.ts`, existing manifest/credit-bound `getAssetBatch` adapter | Retain the accepted 10,000-asset scheduled adapter and budget/ledger; a log-scan retirement must not disable it. |
| Legacy recurring to retire | BNB ownership worker, Base metadata replay/HTTP update loop, market BNB/collection sale replay, leased BNB discovery and Arena projector | Durable cursors/recurring passes require actual owned selection/boot-path retirement. Presence of code never claims that retirement happened. |
| Bounded market admission | BNB/OpenSea `inspect*Admission`; `reconstructPublishedComponents` | Preserve exact-token Transfer windows and same-block maker counter safety. No blanket filename/`getLogs` prohibition. |
| Bounded operator/test | explicitly bounded Arena recovery, witnesses, probes, fixtures/forks | Classification confers no live-provider, paid, signing, restart or recovery authorization. |
| Transport proxy | RPC preflight/adaptive forwarding, method/cost policies and budget proxy | It forwards admitted requests; it is not another discovery cursor. Free/expiry/address/budget policies remain unchanged. |
| Non-scanning consumer | native disclosure and client configuration references | Reads existing evidence; no independent cursor is inferred from a token in a comment. |
| Deployment review | exact unit/launcher/activation command evidence | Every changed launch path must be reviewed; this label authorizes no deployment. |

Mixed file scopes are explicit in the JSON baseline. In particular:

- `bnb/discovery.ts:runBnbDiscoveryPass/readLogs` is a leased recurring
  `OrderValidated` range cursor, even though each pass has chunk/range limits.
  Its unified mode fence and owned retirement remain required.
- The same file's `reconstructPublishedComponents` reads only the publication
  block's maker-filtered `CounterIncremented` events (at most 1,000), verifies
  canonical log ordering and reconstructs the exact order hash. That admission
  safety remains allowed.
- BNB/OpenSea admission uses the exact asset collection/token Transfer filter
  between the indexed checkpoint and current observed block, with existing
  staleness/owner/deployment/canonical checks and no durable scan cursor.
- The legacy HTTP metadata worker's `syncBaseMetadataUpdates` uses
  `getContractEvents`, a 15-second schedule and `metadata.chain_event_cursor`.
  Searching only for `getLogs` would miss this independent scanner.
- `projectConfirmedArena` advances its own legacy cursor in 500-block windows;
  `planArenaRecovery` is an explicit halted operator plan capped at 100,000
  blocks. Retiring the projector must not remove bounded recovery safety.

For a new managed public stager or other code change under `ops`, the workflow
is review-first: run the gate to obtain the changed relative source paths,
inspect the changed call/command/function semantics, then explicitly update the
baseline row/classification/evidence and its literal producer pin in a reviewed
source revision. Keep historical published gate/capture bytes immutable. Never
copy all current candidates into a baseline merely to make CI green. A source
scan passing after review still cannot claim an applied runtime transition.

Evidence rows use `matchSha256` for the digest of the matched discovery/deployment syntax. These are lexical fingerprints; they confer no credential or runtime authority.

## Root-private host capture and validation

The standalone host path is fixed to root on `yunipals-main`. It has no service
mutation verb. Before first host use, review/publish/stage the exact helper and
repository baseline through the separately authorized public-code procedure.
No host procedure below was executed by this preparation.

```sh
# Explicit capture writes a new exclusive 0700 operation / 0600 raw result.
# Use an actual bounded ID; an existing operation can never be overwritten.
python3 -I -B "$OPS/scanner-inventory-gate-v1.py" \
  --capture-host actual-phase6-before

# Root reviews the private capture and prepares a separate protected 0600 plan.
# Validation performs a fresh read-only capture and compares the reviewed plan.
python3 -I -B "$OPS/scanner-inventory-gate-v1.py" \
  --validate-host "$ACTUAL_PRIVATE_PLAN" --plan-sha "$ACTUAL_PLAN_SHA"
```

The capture records all listed system services/timers/sockets/paths, exact
manager restart/dependency/activation/Exec/hook properties and aliases. It hashes
actual fragment/drop-in paths and system/user boot units, links, cron/anacron/at
spools, SysV runlevel/init files, supervisor configuration, user PM2 saved
configuration, user units/autostart and linger paths. It captures current
process argv/executable/UID/GID/cgroup frames without reading process
`environ`. It never runs a discovered command, config or scanner. Only fixed
read-only manager `list-units`, `list-unit-files` and `show` verbs are available.

Two exact boot/manager/file snapshots must agree. Processes that actually exit
while being read are observationally omitted; present processes need stable
start ticks during the read. Every non-collector process frame and its count
requires a reviewed plan row. This inventory is not source PID/session or
kernel-exclusive database-writer authority. The audit's exact `python3 -I -B` CLI and at most its direct shell's exact
literal invocation (optionally prefixed `exec`) are retained in the private
report but excluded from launch-plan hashing, avoiding a circular plan-SHA-in-argv
input. `echo`, compound commands, substitutions, redirection and extra arguments
refuse this exemption. No other ancestor, process or unit is exempted.

The private capture schema is `yunipals-scanner-inventory-gate-v1-host-capture`.
The plan schema is `yunipals-scanner-inventory-gate-v1-host-plan`:

```json
{
  "format": "yunipals-scanner-inventory-gate-v1-host-plan",
  "phase": "before-retirement",
  "bootId": "ACTUAL_SAME_BOOT",
  "repositoryManifestSha256": "ACTUAL_FIXED_PUBLIC_BASELINE_SHA",
  "captureProducerSha256": "ACTUAL_REVIEWED_HELPER_SHA",
  "entries": {
    "ACTUAL_PRIVATE_INVENTORY_KEY": {
      "inventory": {"ACTUAL": "exact launch_rows(capture) row"},
      "classes": ["deployment-review"],
      "reason": "Actual root review, never an automatically allowed wildcard."
    }
  }
}
```

There is no emitted permissive plan generator. Root must review actual private
argv/configuration and preserve exact `launch_rows` values. Unknown, changed or
extra services/timers/cron/boot links/process frames/counts refuse. Raw argv,
configuration paths/targets, process frames and full graphs stay in the host
root-private result/plan. Stdout contains only unit names, counts, hashes and
scope flags. Errors withhold raw diagnostics; source drift lists only relative
public source paths.

`phase: retired` additionally requires every entry explicitly classified as a
legacy scanner to be a terminal, non-boot-reachable unit. A remaining legacy
process/cron/wants link refuses. Dormant retained definition files can be
classified as deployment evidence; that never allows an active scanner. Enabled
or active timer/path/socket and restart/dependency propagation are checked;
a disabled inactive timer alone is not falsely treated as running. Exactly one
reviewed `yunipals-indexer.service` must be the active shared Ponder and Solana
parent. Container or PM2 restart policies require a separate reviewed extension
and deliberately remain unqualified if those schedulers are present. Arbitrary
external orchestrators, obfuscated cron commands and unknown scheduler policies
are not certified by this version.

The host path is bounded to 3,000 unit names, 128-unit manager batches, 10-second
manager calls, 15,000 boot nodes/64 MB of config bytes, 8 MB per config file,
8,192 processes and 16 MB of argv bytes. Acceptance requires the capture window
at most 90 seconds; failures are not automatically retried. Missing/opaque
manager fields are recorded as absent, never normalized to empty proof. Any
normal concurrent runtime/cron/manager drift can require a new explicit private
review. No root/private directory permissions are broadened.

Referenced installed scripts/bundles are not opened or hashed by the launch
inventory. An unchanged ExecStart or cron pathname may therefore point to changed
program bytes. Both capture and validation explicitly return
`installedProgramProvenanceQualified: false`, `scannerRetirementAccepted: false`,
and `requiresIndependentRuntimeManifestReceipts: true`. A same-path/changed-script
regression proves these flags stay unqualified even when launch inventory itself
is unchanged. Separate authenticated installed-program/dependency/runtime
manifest receipts and current epoch checks are mandatory before any caller may
accept retirement. This helper has no retirement-acceptance API.

Even a successful host comparison is only a byte/launch inventory leaf. It
returns `productionSingleIngestorAccepted: false` and `sourceActorQualified:
false`. Managed current epoch, source/DB exclusivity and sessions, canonical
readiness, exact permissions, actual scanner-retirement receipts, consumer
acceptance and approved runtime/dependency bytes remain independent gates.

Twenty-five local controls pass, including new scanner/filter/Ponder/activation
entrypoints, scoped runtime-data exclusions, changed/missing source bytes, unknown
service/timer/cron/boot/restart paths, duplicate live process frames, exact safe
collector shell versus embedded/substituted commands, same-path changed installed
script non-authority, repository/declared-root symlink target refusal, two-snapshot drift and real exclusive private filesystem
captures. Their host/process/manager facts are fixtures; no host capture ran.
