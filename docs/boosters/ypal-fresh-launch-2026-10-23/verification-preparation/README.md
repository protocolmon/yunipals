# Fresh YPAL BaseScan verification

This new verifier covers the YPAL token, three implementations and three proxies
from the canonical ten-action deployment manifest. The older booster and batch
verification scripts and their results remain unchanged.

The default command is offline and does not load the API key:

```sh
python3 -B scripts/boosters/verify_ypal_basescan.py
```

It checks the frozen package, compiler proof and source inputs. With the actual
manifest, it additionally derives each actual contract address and constructor
from its confirmed receipt and the exact reviewed creation transaction:

```sh
python3 -B scripts/boosters/verify_ypal_basescan.py --confirmed docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json --node /opt/node-v24.18.1/bin/node
```

`verification-package.prepared.json` records this offline preparation for the
actual manifest SHA `3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c`.
Its plan SHA is `e33fbe5b07cf6a79a5d77b0e5738d93516fc5ab5c179571236b258c1daba943a`.
Its `chainQualified:false` is intentional: preparing source and constructors does
not perform the fresh chain reads needed before explorer publication.

## Source and bytecode closure

- YPAL: pinned `contracts/ypal/evidence/ypal-standard-input.json`, Solidity
  `v0.8.28+commit.7893614a`, Paris, via IR, optimizer one run.
- Registry, NFT and engine: pinned permit input
  `docs/boosters/permit-engine-upgrade-2026-10-23/solc-standard-input.json`, Solidity
  `v0.8.30+commit.73712a01`, Cancun, via IR, optimizer one run.
- Proxies: the new `proxy-solc-standard-input.json` contains the eight exact
  transitive OpenZeppelin sources. The two proxy entry sources omitted from the
  permit-engine input are included without modifying that frozen input.

All use metadata bytecode hash `none`. `compiler-proof.json` records standalone
compilation matching every reviewed creation byte and runtime template, with
complete ABIs. It also proves that these exact proxy sources produce identical
creation/runtime bytes at optimizer runs 1 and the historical setting 200.

## Read-only chain qualification

```sh
python3 -B scripts/boosters/verify_ypal_basescan.py --confirmed docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json --node /opt/node-v24.18.1/bin/node --qualify
```

The pinned backend `readConfirmedDeployment` rechecks all ten signed transactions,
canonical receipts/headers, actual CREATE addresses, seven current runtimes,
PMON/self immutables, implementation slots, roles, token backing/owner/domain,
fresh pack type 1 and the complete active rules/catalog.

This deployment check uses only `https://mainnet.base.org`, with no credentials,
no caller-selected endpoint, no retries, at most 128 read RPC requests and a
180-second window per qualification. The RPC allowlist contains only chain,
block, transaction/receipt, code, storage and `eth_call` reads. Transaction methods
are rejected before transport. Its evidence explicitly records that the indexing
financial profile was not used or changed. The existing indexing policy excludes
some required deployment reads; this verifier does not modify it or claim that
it accepted the deployment.

## Explicit verification after operator review

The following publishes public source data to the explorer. It does not send an
onchain transaction or spend gas. Run only after reviewing the exact source files,
plan, tests and confirmed deployment:

```sh
python3 -B scripts/boosters/verify_ypal_basescan.py --confirmed docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json --node /opt/node-v24.18.1/bin/node --submit e33fbe5b07cf6a79a5d77b0e5738d93516fc5ab5c179571236b258c1daba943a --output docs/boosters/ypal-fresh-launch-2026-10-23/verification/basescan-results.json
```

The existing `verify_basescan.load_key` reads the already configured
`ETHERSCAN_API_KEY` or the existing protected `.env.verification.local` file.
No new key is requested or created. The key is loaded only after actual chain
qualification and is never passed to the Node child or included in output.

Token and implementation acceptance requires a full source/compiler/ABI and
constructor match. A proxy may have a BaseScan similar-source record, which is
reported as `similar-proxy`. Its exact eight-source transitive closure, ABI and
byte-reproduced compiler settings must match, and the referenced full source is
independently fetched and checked. A similar record's constructor belongs to its
reference contract; the new proxy's constructor is instead proven from its own
signed creation transaction. A similar proxy is never labelled a full match.

All three `verifyproxycontract` associations are checked against their actual
confirmed implementation addresses. Every final source record is independently
fetched again, and the current chain qualification is repeated before completion.
Initial and final qualifications together use at most 256 fixed-endpoint read
requests. Explorer requests and job polling use the existing bounded helper.

Public source/proxy GUIDs are saved before polling. Re-running the same explicit
command resumes the exact saved plan and GUIDs; a different manifest/plan is
refused. Unknown, incomplete or changed records cannot produce a successful
completion result. The output basename must be `basescan-results.json`.

## Offline validation

```sh
python3 -B scripts/boosters/verify_ypal_basescan.test.py
node scripts/boosters/verify_ypal_basescan_chain.test.mjs
```

Seventeen Python controls cover source/ABI/compiler/constructor changes, proxy
similar references, strict live qualification, credentials isolation, exact
submissions, association rechecks, GUID continuation and failure after a previous
completion. Six bridge controls exercise actual viem HTTP serialization with a
synthetic fetcher, including storage/contract reads, forbidden transaction
methods and the exact request cap. Tests make no real explorer or provider calls.
This preparation does not claim that any new contract has been explorer-verified.
