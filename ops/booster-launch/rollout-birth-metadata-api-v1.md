# Per-NFT birth metadata API rollout

This owner updates only `yunipals-booster-api.service`. Default execution is read-only review. No production action was performed while preparing this package.

The candidate API is `ba5c82cb8d587b8f5826fbce72c4630d2098ed36ce892ea92196ec5a5cf9b6db`, manifest `72238adfb06ab3ce7f553cf025f74c410901b9fa6de6b9bd3118770bf903c3a4`. The queue bundle remains `e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33` and is copied only to preserve complete manifest contents; this owner never starts or changes its worker/timer.

The pinned existing API is `8ec7c082de7cbf232923493be6c548f02a4a7a24612807b5845360431c65095c`, PID `1634534`, invocation `0d69de93429a4c03859963d2273889aa`. Its unit SHA is `21179b01409153e52f27eea67a8c2c5b1b941fb6f94b8acf8c145c6b54cfcd6f`. Review refuses changed ownership, process identity, arguments, unit/drop-ins, artifacts, pool settings or existing rollout/release paths.

The exact unit delta replaces the two existing release-root paths and appends one literal public setting immediately after the unchanged environment-file line:

```ini
Environment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-standard-v1
```

The helper does not open the environment file or credentials. It performs no SQL/grants, schema changes, chain/provider calls, wallet operations or upstream requests. The separate journal SELECT admission has already been committed by the owner; this rollout does not repeat it. The shared Ponder source, temporary booster source and both BNB actors are captured before review and must retain their identities throughout.

Stage these four public inputs together in a fresh root-protected operations directory: `rollout-birth-metadata-api-v1.py`, `booster-api.mjs`, `booster-artwork-sync.mjs`, and `manifest.json`. Preserve the executed request-monsters rollout and old API release. For example:

```sh
python3 -I -B /opt/yunipals-unified/operations/booster-birth-metadata-api-20261023/rollout-birth-metadata-api-v1.py
```

Inspect the actual default review, then use `--apply REVIEW_HASH` only for that unchanged review. It creates `/var/backups/yunipals-booster-birth-metadata-api-v1-20261023/`, saves original unit bytes and action intent, installs the candidate in its content-addressed release directory, links the retained protected dependencies, atomically changes the API unit, reloads systemd and restarts only the API. It creates no boot links. The complete operation has a 90-second limit; endpoint warmup is bounded and automatic restart retries are forbidden.

Before rollout, readiness/types, the genuine completed request and its exact `/monsters` result must return 200. The new `/v1/boosters/metadata/0x105319be2182018c31fb10b1be198c3cf238a146/1.json` route must return 404 on the old API. Review captures the approved shared variant document from `/v1/boosters/art/base-mainnet-smoke-v1/73.json` and binds its digest into the review hash. Token 1 and variant 73 are intentionally different identities.

After rollout, the same request checks remain required. The token 1 metadata must return 200 with `birthMetadataVersion: 1`, token/original IDs `"1"`, original status, birth day zero, a positive actual mint timestamp, matching original mint witness and the numeric `Born` date attribute. The image, all four original trait attributes, holo settings and other shared variant properties must remain equal to the approved shared document. The shared document digest must also remain equal to the pre-rollout review. A mismatch produces no successful rollout receipt.

`--inspect` reconciles the observed state after a lost forward acknowledgement without repeating a restart. `--rollback OPERATION_SHA256` explicitly restores the recorded old API unit and, when needed, restarts only that service. It checks readiness, the still-working request route, absence of the new metadata route, unchanged shared artwork and unchanged independent actors. Old and new release files remain available. A lost inverse acknowledgement requires inspection, not another automatic inverse. These boundaries retain the reviewed predecessor owner protocol.

Successful results are saved as `result.json`; explicit inverse results use `rollback-result.json`. The new unit/artifact/runtime receipt and the separately admitted journal read must be acknowledged by any later full consumer handover successor. Existing frozen consumer receipts and API bindings are historical evidence and are not edited or relabeled by this owner.

Local validation: `python3 ops/booster-launch/rollout-birth-metadata-api-v1-test.py -v` passes 13 controls using real files and synthetic manager/HTTP observations. The tests cover the exact catalog-line delta, preserved request route, new birth identity/date checks, image/traits/foil equality, shared-art drift, explicit inverse, failed candidate, lost restart/reload acknowledgements and refusal of altered actors/artifacts/old release. The candidate's separate API suite passed 35 tests before its canonical build. These results do not claim live API deployment or on-chain metadata configuration.
