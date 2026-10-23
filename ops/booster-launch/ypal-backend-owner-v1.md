# Inactive YPAL source preparation only

This version does **not** stop an indexer, install/start the fresh source unit,
change a selector, grant a read, switch the API/queue or execute SQL. It prepares
new private output files and runs one transient offline build probe. A later
reviewed owner must consume this result and the actual new RPC admission receipt
before any live source transition. `liveBackendReady` remains false.

The actual confirmed deployment is
`docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json`, SHA-256
`3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c`.
The owner consumes the fixed public package12bad and exact backend reader94b.
Historical reader24bc/preparation10-test evidence is retained; the corrected
reader's eleven tests additionally cover the real viem `/unified` wire path.
That old unified profile cannot perform `eth_call` or storage reads and does not
admit the fresh addresses. It is never relabelled as a fresh qualification.

## Fixed inputs and public staging closure

Root stages only reviewed public files beneath
`/var/backups/yunipals-ypal-backend-input-v1-20261023` (root0700):

- `ypal-backend-owner-v1.py` (root0600).
- `launch.unsigned.json` (12bad), `confirmed.json` (3249), and
  `artwork-manifest.json` (79e85), all root0600.
- `public/ops/booster-launch/ypal-backend-prepare-v1.mjs` (94b),
  `public/ops/booster-launch/ypal-backend-qualification-v1.mjs` (dcb7), and
  `public/packages/yunipals-market-core/src/boosterAbi.ts` (580b).
- `public/package.json`, exact bytes `{"type":"module"}` plus newline. This
  prevents a typeless-package warning when Node imports the staged public ABI.
- `public/node_modules`, an explicitly reviewed root-owned symlink to
  `/opt/yunipals-unified/booster-api-releases/41fe9b9cb87edaa5689ed611cd2c99b299215be7c8fb6262b560660854657c73/node_modules`.
  Reuse the accepted dependency graph; do not install dependencies or package
  `.env`, caches, database files or credentials in this closure.

The fixed observer `ypal-old-runtime-inventory-v1.py`703402 must be staged at the
historical operations directory, with its existing hash-pinned v7 and8f
dependencies. It performs no production writes. The public profile proposal
must already exist at
`/opt/yunipals-unified/operations/free-replay-20261020/ypal-rpc-19212/profile.json`,
SHA0e19f87a728a0150fae82e6125436739864edd86a6b5b1ecdfcd3503e70e0e05.
It has exact profile ID25308, three fresh retained-source008 ABI descriptors and
individual actual proxy starts52995007/52995029/52995174. Reading this public
file during an offline build does not admit its DB policy row or start a proxy.

The separate qualification writer accepts only fixed public
`https://mainnet.base.org` read methods, at most160 requests in180 seconds, with
no credentials, redirects, retries, signing or broadcasts. It validates all ten
actual receipts/current code and returns explicit `financialProfileUsed:false`
and `sourceAdmissionQualified:false`. Its default is read-only. Root may create
the exclusive first protected receipt after reviewing the writer:

```sh
/opt/node-v24.18.1/bin/node \
  /var/backups/yunipals-ypal-backend-input-v1-20261023/public/ops/booster-launch/ypal-backend-qualification-v1.mjs \
  --record-initial
```

This creates `chain-qualification.json` once. For a later fresh qualification,
use `--record-run <new-lowercase-run-id>`; that creates a separate
`qualifications/<run-id>/result.json`, retaining prior receipts unchanged. A
timestamp never grants host authority: the host owner re-runs the actual chain
reader during review and immediately before the first preparation effect.

## Review, one probe, inspection and abandonment

Once root has independently reviewed and staged the exact code/input hashes:

```sh
python3 -I -B \
  /var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-backend-owner-v1.py \
  --qualification-file /var/backups/yunipals-ypal-backend-input-v1-20261023/chain-qualification.json \
  --qualification-sha <actual-receipt-sha256>
```

The default only reads and returns a review hash. Apply the same command with
`--apply <actual-fresh-review-hash>` only after reviewing the concrete report.
The effect is limited to the inactive preparation below. It requires a fresh
BASE and output root; it cannot be repeated over an existing intent.

The new output root is
`/var/lib/yunipals-booster-ypal/base-ypal-v1-source008`. The existing qualified
source008 code, dependencies and Vite layout stay in their original location.
The private probe namespace binds **only** the new `.ponder`, `.vite-temp` and
generated `ponder-env.d.ts` over the old project's corresponding output paths,
and binds the new config read-only over its old config pathname. Outside the
namespace, original generated/cache bytes are hashed before and after, while
the full retained source manifest, overlays, Vite/dependency links and original
actors/private-file hashes are rechecked. No broad old-tree writable mount is
created. The generated config overrides all three contract starts individually
to match the new manifest while retaining the five-connection pool setting.

The single `yunipals-ypal-build-probe-v1.service` runs for at most45 seconds with
1GB memory, no swap, one CPU, low IO weight, private networking, no new
privileges and a strict filesystem. Real DB sockets and all known private env
files are inaccessible. Only the public fresh environment and an explicit dummy
DB URL are supplied; the script additionally refuses all fetch/socket attempts.
It executes the installed Ponder config, schema and indexing-handler build and
records the **actual** build ID. It never assumes the old6d build ID is the fresh
one. The operation checks at least25GB disk reserve plus1GB scratch headroom and
1.5GB memory headroom before work, and preserves25GB after the probe.

The prospective source unit, reader environment and drop-in are merely saved
under the protected evidence directory. No new source unit is installed or
enabled, and existing services and database rows are unchanged.

Evidence lives at
`/var/backups/yunipals-ypal-backend-owner-v1-20261023`: immutable `operation.json`,
action intent/result, candidate files and `result.json`. Use the same original
qualification arguments with `--inspect` after an interrupted/lost
acknowledgement. Inspection requires the original code/actors unchanged, no new
source unit and a terminal/empty probe. It reports an incomplete prefix without
turning it into a successful build or repeating a start. If the manager/probe
acknowledgement is missing, manual reconciliation is required.

`--inverse <actual-operation-json-sha256>` acknowledges abandonment of only this
inactive preparation. It requires the same original immutable input/reference,
unmodified original actors and no active probe/new source. All output files are
**retained** as evidence; it does not delete caches, undo unrelated state,
restart old processes or claim a running-backend rollback.

## Tests and next live phase

```sh
python3 -I -B ops/booster-launch/ypal-backend-owner-v1-test.py
node ops/booster-launch/ypal-backend-qualification-v1.test.mjs
```

Twelve owner controls cover real filesystem inode/CAS/exclusive intent handling,
the frozen socket mapper, exact actual manifest/profile starts, guarded mounts,
no paid authority and refusal of source/SQL/reader phases. Five qualifier
controls cover the actual viem request boundary, request/time caps, no transaction
method and the minimal staged module closure. They do not substitute for the
actual host systemd/namespace build qualification.

The next separately reviewed live owner must bind this actual prepared result,
the actual `ypal-rpc-admission-v2.py` result and a fresh contract qualification.
Its pre-start adapter must call existing `preflightUnifiedRpc` with the exact
fresh three-source manifest and `endpoints:{8453:newProxyUrl}`; it must not claim
the old all-chain/default-manifest preflight passed. Before starting the one
fresh source it must stop/disable the exact old source, prove old PID/cgroup,
native lock and port drained, and freshly map every remaining writer backend
to the unchanged combined actor. Pool churn is handled by positive kernel
ownership, never a role-wide zero or backend age. Actual complete native
coverage/OIDs, ten-read rollback/admission and API/queue switching remain further
explicit gates. The user-facing fresh product must not fall back to old PROTO
history. Shared BNB progress and OG APIs remain untouched throughout.
