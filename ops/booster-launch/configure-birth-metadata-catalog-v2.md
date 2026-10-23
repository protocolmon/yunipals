# Correct the API's public catalog list

This configuration-only owner retains the installed `ba5c82cb8d587b8f5826fbce72c4630d2098ed36ce892ea92196ec5a5cf9b6db` API and all its artifacts, working directory, arguments and dependencies. It replaces exactly one unit line:

```diff
-Environment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-standard-v1
+Environment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-mainnet-standard-v1
```

The correct second slug is taken from active pack 2's actual indexed metadata URI and its matching protected public manifest. It is neither `base-standard-v1` nor `standard-v1`. The initial rollout's bad list makes birth metadata return `503 {"error":"booster_birth_metadata_unavailable"}` while existing pack, request and approved shared-art routes remain healthy.

The helper imports the exact frozen `c52bc1c081a1a002c0070da331b15c2032da4b108924fa51ddd7f7d656557959` source at `/var/backups/yunipals-booster-birth-metadata-input-v1-20261023/rollout-birth-metadata-api-v1.py`. Its protected bytes are checked before execution. It does not change that module's constants or files. It binds the original failed rollout operation SHA `166d85965f934e4d928fa989fe4b7f429048ba09665f39de96dbd0d4f51b2243`, current API PID `1660954`/invocation `40c1f709f1584a358279f96e3bcbf8b8`, and unit SHA `e36c5ad113c7033e6e88c2798d5b8fb8ed548111bf3ed2a462098f50859a2f5a`.

Default execution is read-only review. Stage the new owner in a fresh protected operations location, preserving the prior owner and failed operation records, then run:

```sh
python3 -I -B /path/to/configure-birth-metadata-catalog-v2.py
```

Review requires the exact existing runtime and bundle, healthy existing request-monsters result, precise birth-error baseline, unchanged approved shared variant document, and both active pack catalogs. For each catalog it verifies the protected local manifest's raw SHA, equality with the HTTP manifest, and equality of catalog hash/metadata URI with the corresponding `/v1/boosters/types` row. Pack 2 must use `base-mainnet-standard-v1`; its manifest SHA is `79e85ccfa753bb81d8115a17e963f3b427e276f5e68b24d0a3ee284d85c3c2bf`.

After reviewing the output, `--apply REVIEW_HASH` creates only the fresh `/var/backups/yunipals-booster-birth-metadata-catalog-config-v2-20261023/` evidence directory, saves the original unit, replaces that single line, reloads systemd and restarts only `yunipals-booster-api.service`. It rechecks the original actor immediately before the restart. It does not install another artifact or release. There are no SQL, grants, credentials, environment-file contents, source processes, BNB services, queue workers, provider requests or wallet actions involved.

Success requires the existing request routes, NFT 1 birth metadata version 1/day zero/positive `Born`, and exact preservation of its approved image, four traits and foil metadata using the unchanged frozen core's acceptance checks. Both catalog bindings and all independent actors must remain unchanged.

`--inspect` reconciles a lost forward acknowledgement without another restart. `--rollback OPERATION_SHA256` restores only the original recorded unit configuration and, if needed, restarts the same API. That inverse deliberately restores the known birth-metadata failure while keeping the existing routes healthy; it is not a claim that the incorrect catalog list is desirable. Failed inverse acknowledgements are inspected rather than retried automatically. Original and corrected evidence are retained separately. The entire owner is bounded to 90 seconds.

Eight focused controls pass with real files and synthetic manager/HTTP observations: exact config delta and unchanged bundle, actual catalog names/pins, wrong actor/unit/catalog refusal, successful birth checks, failed birth acceptance without a success receipt, lost reload/restart acknowledgements, explicit inverse and foreign-runtime refusal. No live action was performed while preparing or testing this owner.
