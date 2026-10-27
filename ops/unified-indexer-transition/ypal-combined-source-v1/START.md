# Combined YPAL source replacement

This operation replaces only the original combined source008 invocation. It
starts evaluated build `71e2a7f3b7` in new namespace
`unified_ypal_20261023_v1` with pool max5, heap4096MiB and memory limit6GiB. The
standalone fresh YPAL source, API, queue/timer, its19212 proxy, and old four
19201–19204 proxies retain their acknowledged actors/configuration. No reader,
worker, marketplace or Solana selection changes here.

The full candidate manifest replaces only the obsolete three PROTO booster
addresses with the confirmed fresh YPAL proxies at their individual creation
blocks. All other descriptors remain source008. Four separately admitted
free-only routes19221–19224 serve the new full manifest. Existing financial
expiry, budgets and paid authority remain unchanged; no permit is created.

## Accepted build and fixed inputs

- Host inactive build result:
  `/var/backups/yunipals-combined-source-inactive-build-v1-20261023/result.json`
  SHA256 `e09e54bfba64e345f53bf7c0488cc21b3f20f025448f995fed6e12677af4fd3d`.
  Actual UID970/GID964, build71e2, pool5, matching config/schema/indexing/contracts,
  twelve intercepted offline fixtures, zero sockets/DB/provider calls; all eight
  original actors and physical source files unchanged. New namespace/AREA absent.
- Candidate source digest:
  `02e217b73809bf22aed75a35407a2c175c16f49a7eab91c674be86de28507984`.
- Flat public staging directory:
  `/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage`.
  The eight initial staged build files remain unchanged. Add the independently
  reviewed `start-source.py` and
  `yunipals-ypal-combined-source.service.example` as new protected files; never
  overwrite the existing payload. The example's SHA256 is
  `4ddfaa8bf5d50be23e5caf920b8b9bf982c82d1c36b0d6977855a0e117d4f7fb`.
- RPC dependency has a fixed loader path:
  `/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-routes-v1.py`.
  Its actual reviewed producer SHA and completed routes result SHA are explicit
  required inputs. Neither a future runtime receipt nor route health is assumed.

## Root review and one owned start

Run after the separate four-route owner has a completed, validated actual result.
The variables below denote actual SHA values supplied by root, not synthetic
receipts. Default review reads only. It checks the original8f/add6 qualification
while PID716994/c346 is still alive,
198 retained public source files, actual host build, complete frozen inputs,
new namespace/unit/cache absence and the old root boot link inode131541/dev2049.
Memory available must be at least6GiB; root free space at least25GiB.

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage/start-source.py \
  --rpc-owner-sha "$COMBINED_RPC_OPERATOR_SHA" \
  --rpc-result-sha "$COMBINED_RPC_RESULT_SHA" \
  --build-result-sha e09e54bfba64e345f53bf7c0488cc21b3f20f025448f995fed6e12677af4fd3d
```

Review the returned binding/reviewHash. Run the same command once with
`--apply "$COMBINED_SOURCE_REVIEW_HASH"`. It repeats the real review, writes
exclusive protected intent, installs only the new source unit/cache, removes
only the captured old boot link, gracefully stops the exact old invocation,
and positively accounts for the remaining fresh-source PG backends. It then
starts the new source once. Original native checkpoints are preserved as
read-only receipts; none are copied or relabelled into the new namespace.

A fresh per-unit `.ponder`, `.vite-temp` and `ponder-env.d.ts` bind isolates the
live shared workspace. The three config overlays are read-only. Only the new
process uses these mounts. New native tables and sync cache writes come from
ordinary Ponder startup, not owner SQL. Source DB pool capacities become5+5,
within the unchanged role limit32. The old native namespace/cache stays present.

The result records actual build, OIDs/checkpoints, actor, boot link and session
ownership. `nativeFrameworkReady` is observed; `nativeCoverageAccepted:false`
and `readerOrWorkerSelectionsChanged:false` remain explicit. Build/bootstrap
acceptance is not a canonical caught-up/readiness proof. Actual ongoing native
checkpoint advancement and readiness/parity remain the next acceptance steps.

## Inspection and exact inverse

Protected operation directory:
`/var/backups/yunipals-ypal-combined-source-start-v1-20261023`.
All receipts are exclusive and retained. The operation SHA below is the actual
SHA256 of its `operation.json`; capture it even if the manager ACK is uncertain.
Never rerun `--apply` against an existing operation.

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage/start-source.py --inspect "$COMBINED_SOURCE_OPERATION_SHA"
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage/start-source.py --reconcile-start "$COMBINED_SOURCE_OPERATION_SHA"
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage/start-source.py --restore "$COMBINED_SOURCE_OPERATION_SHA"
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage/start-source.py --finish-restore "$COMBINED_SOURCE_OPERATION_SHA"
```

`--reconcile-start` is only for an actual matching new invocation after a durable
start intent and missing ACK. It never starts a process. It can finish the exact
owned boot publication and acknowledge real native bootstrap, not coverage.
Foreign process/argv/env/config or unrecorded boot publication is refused.

`--restore` stops only the owned new source, including its proven automatic
restart, removes only its exact owned boot link/unit, restores the original
old boot symlink inode, and starts the old program once under durable inverse
intent. It preserves both native namespaces and all caches. It does not need
new proxy HTTP health to stop the new source. Original source code/private env
hashes and the separately preserved live YPAL/old routes must still match.
It never calls the obsolete whole validator after the old source is drained or
restored with a new invocation; the result says so explicitly.

`--finish-restore` only observes already requested inverse manager actions and
acknowledges proven terminal/running state. It never repeats an uncertain
stop/start/reload. A missing effect stays refused for root reconciliation.
A lost filesystem ACK before an inode receipt (partial installation or boot
preparation) may require narrow manual reconciliation; no automatic retry or
foreign adoption is claimed.

Both source and routes owners use exclusive nonblocking
`/run/lock/yunipals-ypal-combined-transition.lock`. Route inverse separately
requires the new source terminal before every proxy stop. Do not bypass this
lock or remove new routes while the new source is running.

## Local focused verification

```sh
python3 -I -B ops/unified-indexer-transition/ypal-combined-source-v1/start-source.test.py
```

Thirty controls cover real boot symlink inode preservation/foreign refusal,
real shared-lock exclusion, actual root-sticky lock directory and fd/path fence, real directory modes under umask077 (ownership
syscalls are asserted in the local sandbox), actual missing-ExecStart systemd
shape, GC-safe terminal state, exact argv/start boundary, wrong actors, post-intent actor fences, exact qualified old inherited/bounding
capability policy versus zero new capabilities, first
start versus inverse restart, no-repeat lost start/stop ACKs, current native
checkpoint preservation, empty Node exec environment versus conflicting public
keys, retained private-input mutation and code/role drift, and independence of inverse from new-route health.
The finish-only inverse tests also run the real restore function on owned filesystem
fixtures interrupted before boot unlink, before unit unlink, and after unit unlink;
each finishes with one required reload and no repeated start/stop.
No local control performs production writes, service actions or provider calls.
