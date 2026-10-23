# Fresh YPAL backend preparation

This operator prepares a separate YPAL collection. It has no host apply, service
manager, SQL execution, signing, deployment or broadcast mode. No fresh contract
addresses are supplied in this repository: use the owner page's actual completed
ten-step export, format `yunipals-ypal-fresh-deployment-confirmed-v1`.

The existing public package is
`apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json`, SHA-256
`12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886`.
It contains seven creation transactions, NFT metadata configuration, one public
pack configuration and activation. The backend rechecks the exact package,
creation input, actual successful receipt, transaction sender/chain/value/nonce,
CREATE address, canonical block and current contract state. It never treats an
exported success flag as proof of deployment.

The reusable function is:

```js
const verified = await readConfirmedDeployment(
  readOnlyClient,
  unsignedPackage,
  confirmedDeployment
);
```

It reads all contract state at one explicit block, rechecks that block's hash at
the end, and returns verified addresses, implementations, source start block,
seven runtime hashes, ten actual receipt records and the block witness. It checks
the UUPS slots and UUIDs, expected owner's four admin roles on each proxy, engine
dependencies/MAX10/permit1, YPAL owner/backing/burn address/name/symbol/decimals/
permit domain, NFT metadata base, exact approved catalog and activated unlimited
type1. It checks the owner's expected role membership; it does not claim an
enumeration of every possible AccessControl member. Legitimate purchases after
activation do not invalidate the deployment. Changed, pending, reverted or
reorganized deployment receipts do.

The retained approved artwork manifest is copied verbatim into the new public
document `docs/boosters/ypal-fresh-launch-2026-10-23/backend-approved-artwork-manifest.json`.
Its SHA-256 is
`79e85ccfa753bb81d8115a17e963f3b427e276f5e68b24d0a3ee284d85c3c2bf`.
The collection reuses `base-mainnet-standard-v1`, artwork commitment
`0x29c9b8dfc3c35854a0396850a4e40da3457cf44a9901157c67564b92d61276ac`,
catalog hash
`0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733`
and all approved files. No artwork is regenerated.

## Read-only commands

From a checkout with the existing application dependencies, a static review is:

```sh
node ops/booster-launch/ypal-backend-prepare-v1.mjs \
  --package apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json \
  --confirmed /path/to/actual-owner-export.json \
  --artwork docs/boosters/ypal-fresh-launch-2026-10-23/backend-approved-artwork-manifest.json
```

This module is checkout-relative: it uses the already-installed frontend viem
dependency and the pinned shared event ABI source. Do not stage the single file
alone into the historical operations directory and claim it is self-contained.
Stage the finite public checkout closure or reuse the pure exported function
inside a caller that has that same verified source/dependency layout.

Static review explicitly reports `chainQualified:false` and cannot emit output
files. When root authorizes the actual read-only chain check, add
`--verify-free-rpc --output /path/to/new-preparation-directory` on the production
host. This uses only the fixed existing loopback Base proxy
`http://127.0.0.1:19202`, with the existing profile and `unified_evidence` workload,
zero retries, no permit, and free-only/zero paid-call preflight checks before and
after. It does not accept alternate RPC URLs or load any private configuration.
The profile's existing expiry remains in force; this provides no renewal or paid
authority. Operator output is a preparation report, not a running-source receipt.

Local controls:

```sh
node ops/booster-launch/ypal-backend-prepare-v1.test.mjs
```

They exercise real pinned ABI encoding, CREATE addresses, immutable runtime
patches and tamper refusals with a synthetic read-only chain client, plus exact
fresh output bytes and permissions. They make no network requests, database
changes or service calls. These are preparation tests, not a production chain or
host qualification.

## Exact future transition and remaining gates

The candidate namespace is `yunipals_boosters_ypal_v1`; the separate source unit
is `yunipals-booster-ypal-source.service`. The candidate uses source008 in a new
workspace under `/var/lib/yunipals-booster-ypal/base-ypal-v1-source008`, with its
own `.ponder` output. It retains the qualified normal free-only transport,
client concurrency2 and pool maximum5. Source008's original files, combined
source716994, `unified_shadow_20261020_7e7375b0`, BNB cache and replay checkpoints
are not changed. The candidate binds port9026 only after the old source is fully
drained; root must confirm that actual port and its ownership before applying it.

No candidate file may be installed directly without a fresh protected host
review and a separate explicit owner action. That owner still needs to bind the
actual current unit/definition/environment hashes, invocation/PID/start ticks,
full actor/cgroup/session inventory and native catalog. It must also qualify the
fresh workspace's exact copied source/dependencies/Vite aliases under the actual
UID970/GID964 sandbox with networking blocked. Copy only verified public source
and qualified dependency links; do not copy the old `.ponder` cache, generated
files, private env or production data. The existing protected source008
`launch.env` is referenced by path and never read or copied by this preparer.
The new source's build ID is an actual output of that probe, not the old build ID
assumed by this plan.

The future owner's finite order is:

1. Reverify the actual ten on-chain actions and fresh current-state witness.
   Bind that report and the package/export hashes into the protected host review.
   Require the new schema, source unit and workspace to be absent; check disk
   reserve, existing source role capacity and the unchanged free-only policy.
2. Prepare the new source **inactive**, and record the complete old launch
   definition, boot links, runtime and schema/catalog for a possible inverse.
3. Stop and disable only the exact owned old `yunipals-booster-launch.service`.
   Refuse a foreign/restarted actor. Prove terminal PID0, empty old cgroup, port
   closed, native app unlocked and the old source's five connections drained.
   There is no period with both old and new source pools running. Preserve old
   schema, native cache and workspace as rollback evidence. Do not stop OG or
   shared BNB services. A failed stop acknowledgement requires reconciliation.
4. Start the new exact source once, record its new identity and validate native
   schema/table OIDs/build. Require current native ready, a complete fresh Base
   checkpoint and two durable quiet-block advances. Heartbeat alone is not
   coverage. Require the indexed type1's addresses/token/rules/catalog to match
   the chain qualification and no old/test deployment identities in the new
   domain tables. Do not assert that legitimate newly purchased requests must
   be absent.
5. Capture the actual new namespace/owner/reader/table OIDs. `readerSql(catalog)`
   produces guarded ROLLBACK and separate COMMIT SQL for only schema USAGE plus
   ten SELECTs (`booster_event` included for recent feed and birth provenance).
   It emits no role, LOGIN, password, write, default-privilege or old-schema
   change. Root must rehearse exact SQL, bind the full prior/after ACL graph and
   actual receipt, then apply under separate authorization. No placeholder OIDs
   are generated. An inverse must remove only its own new edges after checking
   that exact graph; existing grants are preserved.
6. Drain the exact API and artwork queue/timer under their owner protocol.
   Preserve the currently accepted API artifact41fe, queue artifacte2b, Node,
   UID967/GID961, existing protected database connection and sandbox. Install
   only the generated public reader overlay at
   `/etc/yunipals-unified/booster-ypal.public.env` and reviewed per-unit drop-ins.
   Explicit catalog environment is `base-mainnet-standard-v1` on both API and
   queue so old literal unit settings cannot override the env file. No private
   environment file is edited or exported. Keep the six-connection collector
   budget; API pool2 and queue pool1 remain bounded.
7. Start the owned API, require `/readyz` and `/v1/boosters/types`200 for the new
   collection/engine, exactly public type1/YPAL and correct approved rules. Check
   global collection, recent openings and request-scoped results contain only
   the fresh engine/collection, including honest empty200 pages before sales.
   The old collection/request routes must not return old rows. Check the new
   per-NFT metadata prefix (404 before a real NFT exists is honest), and after a
   genuine completed fresh request validate token provenance/birthday/shared
   art. Run one owned queue observation, then restore only its known timer.
   No image-provider calls are part of this transition.
8. Record actual API/queue identities, native source coverage, SQL receipts,
   unchanged OG/shared BNB actors and public checks. Enable only the accepted
   new source's boot path. A process start is not product acceptance.

Unknown actions are never retried blindly. Before API publication, an inverse
can stop only the owned fresh source, restore exact old definitions/boot state,
start the old source with an acknowledged new identity and verify its old schema.
After an owned API/queue switch, restore their previous public configuration
and prove their reads before reverting only the owned new read grants/source.
Record the inverse as a new receipt; do not rewrite old runtime receipts or
pretend a recreated PID equals the prior one. The user's fresh product must not
silently display old PROTO packs/history during an outage: the frontend must
remain explicitly on the fresh deployment or pending/unavailable until a
separately authorized product rollback.

Later consolidation must replace the old booster deployment in a newly reviewed
combined source manifest, preserve all BNB progress, compare the **fresh** YPAL
source with the combined source at a canonical common boundary, hand over the
API/queue and retire the fresh temporary source. Historical PROTO parity and old
eight-grant receipts do not authorize this new deployment. This preparer does
not reset/restart/rebuild the running combined source or claim that consolidation
has happened.
