# Known YPAL opening for collection API acceptance

The collection rollout can verify transaction status using the already-public
three-original YPAL purchase, without requiring deferred marketplace sale history:

```text
0x62e4c5d0792f1dc955b28601debabaa9240d9aeb596479a9e1f297adcb03e8a7
```

This component selects that exact transaction from the new combined namespace.
It binds release `4e77f52b…`, read identity `cac869bf…`, build `71e2a7f3b7`, the
fresh engine and NFT collection, and the real read-view marker. Its dedicated
client opens one repeatable-read, read-only transaction with bounded timeouts.
Raw event payloads are bounded in SQL before export. Compiled ABI decoding must
agree with the journal arguments and the actual `booster_request` projection.
A request's primary key and original reference use the shared `boosterIdentity`
helper, including the `8453:` chain prefix. Unprefixed keys must be rejected.
A conflicting native canonical witness refuses the fixture. Empty history remains
unavailable; it is never replaced with synthetic or old PROTO openings.

The registered source retains the original published engine and NFT ABI versions.
The repository's later batch-opening ABI adds functions and metadata events.
Those full fingerprints differ even where `RequestCreated` has identical encoding.
The exact source ABI version must therefore be selected and verified; a compatible
event signature alone does not authorize relabelling the source fingerprint.

`positiveYpalAction` checks the subsequent API response against the exact selected
identity, canonical request digest, transaction inclusion, complete coverage and
its matching anchor. It requires `canonical_event` proof and an applied
`booster_request`. Marketplace acceptance separately retains its full-receipt
requirement; this component makes no marketplace acceptance claim.

Run the synthetic and genuine disposable PostgreSQL checks from the repository:

```sh
node --import ./apps/yunipals-indexer/node_modules/tsx/dist/loader.mjs \
  ops/unified-indexer-transition/consumer-ypal-action-v1.test.mjs
```

The component performs no provider call, write, grant, login change, migration,
service action or financial operation. Production fixtures and actual receipts
remain in protected storage. Selecting a fixture does not establish source
readiness, successful API preview, new generation acceptance or consumer cutover.
The frozen historical marketplace preview is unchanged; the new consumer
execution owner must explicitly compose this check with actual current read
admission, runtime, metadata and generation evidence before switching a reader.

The actual read-only production check on 24 October matched ten journal events
and all three request projections at Base block 53,000,661. Its protected fixture
is available for the later preview. It performed no provider call, database write
or service change. No matching retained point-block witness was present; the
fixture does not claim a fresh canonical-source observation or API acceptance.
