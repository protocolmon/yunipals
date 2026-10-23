# Request-scoped booster cards API

The additive GET route is `/v1/boosters/requests/:engine/:requestId/monsters`. It returns the exact completed request set, ordered by numeric token ID, with no owner or burned-token filter. Pending/seeded requests return 409 with empty items; forfeited requests return 409 and `request_forfeited`. Missing requests return 404. A completed request with an incomplete or inconsistent set returns 503. Quantity is bounded to 1–7. All new route responses are `no-store`.

The SQL is one request/original/type/monster snapshot. It uses the existing original-key index, joins the actual request identity and frozen rules, and refuses monsters beyond the ready indexed prefix. It adds no schema, grant, scanner, provider call or durable tracking write.

The canonical build is `node apps/yunipals-indexer/scripts/build-booster-api.mjs` (script SHA `b34936c1efc80aa6d36e8a0940cb4740652186b72a176f0ea2b5cf1668dbd123`). The reviewed API is `8ec7c082de7cbf232923493be6c548f02a4a7a24612807b5845360431c65095c`; manifest `88243717d99d80fdce3f34d453a6e4b1bc2b9e8541381f14ea4c4449b67303df`. The canonical queue artifact remains present for manifest completeness and is not selected by this rollout.

Stage the frozen owner and the three built files in one new root-protected operations directory, without overwriting an older release. The owner expects `booster-api.mjs`, `booster-artwork-sync.mjs` and `manifest.json` beside it. Its default command is read-only review:

```sh
python3 -I -B /opt/yunipals-unified/operations/booster-request-monsters-api-20261023/rollout-request-monsters-api-v1.py
```

After inspecting that actual review, repeat with `--apply REVIEW_HASH`. It copies the public files into the new root-owned release, links the unchanged existing dependencies, atomically replaces only the API unit's working directory/program path, reloads systemd and restarts only `yunipals-booster-api.service`. It preserves the original unit bytes, old bundle and the existing environment-file line without reading environment contents. Shared source, temporary booster source and both BNB actors must retain their observed identities. The rollout creates no boot links.

The owner verifies actual readiness, pack types, an existing genuine completed request and its new exact one-monster mapping. That public request ID is `95398210973416432093304839780870626144645280554838792215361305546672924156888`, engine `0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609`, original/token 1. No transaction is sent.

Receipts live under `/var/backups/yunipals-booster-request-monsters-api-v1-20261023/`. `--inspect` reads the actual operation after an uncertain forward acknowledgement; it never repeats a restart. `--rollback OPERATION_SHA256` explicitly restores the recorded API definition and original runtime, restarting only the API if necessary. It also handles failure after unit reload while the original HTTP actor is still running. An interrupted inverse requires inspection; it is not automatically repeated. New release files remain available for review.

The successful rollout receipt must be explicitly acknowledged by a future consumer/booster handover successor. Existing frozen validators and their older API definition, actor and bundle bindings remain unchanged; their prior receipts must not be relabeled as accepting this deployment.

Validation: 27 focused API checks passed, including 22 cases running the real route SQL in isolated in-process PostgreSQL, plus full indexer TypeScript checking and canonical build. Nine real-filesystem owner controls passed with synthetic manager/HTTP functions, including request mismatch, wrong artifacts/actors, lost restart and reload acknowledgements, explicit inverse, source-actor preservation and modified-bundle refusal. These controls do not claim a live rollout or native source promotion.
