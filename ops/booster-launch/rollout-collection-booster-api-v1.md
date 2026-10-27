# Global booster collection API rollout

This versioned owner deploys the additive global browse API without changing the corrected catalog configuration, existing birth metadata, source services or permissions. Preparation and tests perform no production actions. The frozen candidate API is `b624dc518556756399a26e691bd1d53d319bd46d20134f9d6e1356dae3d96088` (45083 bytes), manifest `15edcc0f6145f61e22f997ce8ba2c781a8cc22faf72b17ae95caef9e9f0f52e0`. The canonical build retains the unchanged artwork queue bundle. Wrong or absent build pins are refused.

The initial API is the `ba5c82cb8d587b8f5826fbce72c4630d2098ed36ce892ea92196ec5a5cf9b6db` release, PID `1686500`, invocation `8de64ae4e6494e29ad2b22661fe5282f`, with unit SHA `baf2e8edc4b4064004e6606c394fbf0a504bb4bf9d1854e54e5584728d9dfddb`. The owner binds the successful catalog correction's protected operation/result files under `/var/backups/yunipals-booster-birth-metadata-catalog-config-v2-20261023/`; these are preserved as historical evidence. Its canonical result SHA is `587fd326f5dace08e516a01e1e2141375242520815cddceb4ee01625a853c4ef` and operation SHA is `32df4a044256844529bd8d1b0b2dffa2891d9895d6364a688b90fc08cd786bf1`.

Stage the frozen owner beside `booster-api.mjs`, `booster-artwork-sync.mjs`, and `manifest.json` from that final build in a fresh protected operations directory. Default invocation is read-only review:

```sh
python3 -I -B /path/to/rollout-collection-booster-api-v1.py
```

Review verifies the initial actor, complete unit bytes, existing release and dependency root, candidate hashes/read-only pool, acknowledged catalog correction, independent source/BNB actors and approved shared artwork. NFT #1 birth metadata and its completed request's exact monster mapping must already return 200. `/v1/boosters/monsters?limit=24` must return 404 on the old API. The known global probe must still be active; if it has been burned, choose and bind a fresh actual active probe before reviewing a successor rather than silently ignoring that discrepancy.

After inspecting the actual review, `--apply REVIEW_HASH` creates the new evidence directory `/var/backups/yunipals-booster-collection-api-v1-20261023/` and a fresh content-addressed API release. It copies only the exact public build artifacts, links the unchanged protected dependencies, replaces the unit's two release paths and restarts only `yunipals-booster-api.service`. The literal catalog line is required and preserved byte-for-byte:

```ini
Environment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-mainnet-standard-v1
```

No environment-file contents, credentials, grants, SQL, indexer process, queue worker, source/replay/proxy or wallet action is involved. The old actor, independent actors and new unit definition are checked again immediately before the restart. The operation is bounded and never automatically repeats a restart after uncertain acknowledgement.

Acceptance requires the request-scoped endpoint and full NFT #1 birth/image/four-trait/foil checks to remain successful. The new global endpoint must return 200 and include active NFT #1 with its canonical ID, original identity, collection and request key. Every page item must have the fixed collection, canonical token ID, strict numeric ascending order and no duplicate IDs. A page has at most 24 items. A non-null cursor must equal the last token ID of a full 24-item page; a null cursor is valid for any terminal page. Legitimate additional mints do not invalidate the release. The approved shared artwork digest and all independent actors remain bound to the original review.

`--inspect` reconciles a lost forward acknowledgement without repeating the action. `--rollback OPERATION_SHA256` explicitly restores the recorded ba5 unit/runtime, requiring birth metadata to stay 200 and the global route to return its original 404. Only the HTTP API may restart. Release files and all prior receipts remain intact; a lost inverse acknowledgement requires inspection rather than automatic retry. The resulting API binding must be acknowledged explicitly by later full-consumer migration successors.

Seventeen real-file tests with synthetic manager/HTTP observations cover protected prior-catalog receipts, exact unit/environment preservation, approved artwork and birth checks, legitimate growth/full-page cursors, malformed global identities/order/duplicates/cursors, incorrect request membership, altered artifacts/actors, changed actors immediately after reload, failed candidate acceptance, lost reload/restart acknowledgements and owned inverse. They do not claim production deployment or source promotion.
