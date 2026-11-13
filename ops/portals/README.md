# Portal runtime packaging

These files are generic examples. Replace every `@PLACEHOLDER@` before installing a service. Adapt paths, users and settings for your own infrastructure; keep the actual configuration and transaction records outside Git. Node 24 and the frozen workspace lockfile are required. The renderer's bundled fonts and license under `lib/portals/fonts` are part of the release.

Prepare an immutable checkout and run `pnpm install --frozen-lockfile`. Run services from `apps/yunipals-indexer`; the `node --import tsx` entry points use the checked-in TypeScript and shared workspace packages. An upgrade must retain those packages, font files, the artifact directory and database.

## Shared indexer deployment

Production portal events belong to the existing shared Ponder release. Configure `UNIFIED_PORTALS_JSON` on that ingestor with exactly four keys (`collection`, `registry`, `grading`, `competition`), each containing a public `address` and its verified numeric `startBlock`. Include the competition's initialization history, even if binding to grading happened later. Extend the existing shared release/RPC profile; keep all retained sources unchanged. The source contains no provider or signing credentials.

Use `PORTALS_INDEXER_MODE=unified` in both portal API and worker configurations. Set `PORTALS_INDEXER_RELEASE_ID`, `PORTALS_INDEXER_READ_SCHEMA`, `PORTALS_COMPETITION` and a read-only `PORTALS_INDEXER_DATABASE_URL`. Keep the private `PORTALS_DATABASE_URL` for spells, jobs and signing journals. The shared source reader validates the release and source observations, then reads confirmed projection versions in one database snapshot. Its public URLs remain unchanged.

Prepare a new immutable shared release using the existing shared build/registration procedure. Add the required shared database control/runtime SELECT grants using the existing reader-role procedure. With a migration login, run `portals:shared:prepare --operation read-views --reader-roles <api-reader>,<worker-reader>` to create a fresh, release-bound portal read schema. `DATABASE_URL` is the shared migration connection for this command. The command refuses to replace an existing schema. Ordinary API/worker startup never creates or repoints views.

For an existing private portal database, run `portals:shared:prepare --operation private-consumer` with its migration login and `PORTALS_WORKER_DATABASE_ROLE`. This only adds the durable consumer position and saved job revisions. On a fresh installation, `portals:migrate` in unified mode prepares private state and API/worker grants without creating a public ledger. Keep migration credentials out of services.

Before switching readers, run `portals:shared:compare` with both read connections. It compares the old ledger and shared views in stable snapshots at the same canonical block, hashes every row in all eight public domains, and exits unsuccessfully on any discrepancy. Its report contains counts/digests, not private spells. Candidate ingestion must also pass retained-product parity and the readiness observation window described in `docs/unified-indexer/portals-migration-plan.md`.

Deploy the compatible API/frontend before cutover. Old evidence clients retain version 1 support; new clients negotiate version 2 and bind the shared release/read identity. Pause new worker leases, reconcile in-flight work, switch the shared release and all pinned readers, then resume indexed job consumption. Saved transactions must be rechecked, not resent. Stop and disable the standalone portal ledger after acceptance; its entrypoint refuses unified mode. Retain its release/data for the documented rollback window, without a running scanner.

The legacy instructions below support isolated rehearsals and temporary rollback only. Explicitly select `PORTALS_INDEXER_MODE=legacy` for those environments. Do not install a second ledger in a new shared production deployment. Cleanup must remove the legacy service from startup and verify one EVM ingestor after restart.

## Separate process configuration

Use `apps/yunipals-indexer/portals.env.example` as a settings catalog, not as one shared credentials file. Give each process its own environment:

- API: its database login, public deployment settings, RPC access, artifact directory/public origin, `PORTALS_ENABLED`, exact comma-separated `PORTALS_ALLOWED_ORIGINS`, and optionally `PORTALS_PORT`/`PORTALS_BIND_HOST`. Configure `PORTALS_INTAKE_PRIVATE_KEY` and its matching `PORTALS_INTAKE_ADDRESS` for a dedicated offchain acknowledgement signer. It needs only `INTAKE_ROLE` on the grading proxy and no gas balance. Startup rejects a missing role or admin/config/upgrader/pauser/grader authority on that proxy. Never load the grader or AI credentials into the API; `portals:api` rejects those. The existing main API also mounts portal routes; the separate booster API does not.
- Ledger: its database login, RPC/deployment/start-block settings and `PORTALS_LEDGER_ENABLED=true`. No artifact or AI/signing access is needed.
- Worker: its database login, RPC/deployment/start-block settings, asset access, retained model policies, grading signer and AI credentials. `PORTALS_WORKER_ENABLED=true` explicitly enables processing. `--prepare` still makes paid AI calls. `PORTALS_MAX_EXECUTION_FEE_WEI` limits gas times execution fee per signed transaction; Base's additional data fee is not included in that limit.
- Migrator: a separate schema-owning database login and the three existing role names. Run `portals:migrate` once for initial setup and again for releases. It creates the dedicated schema/tables and grants runtime privileges. Never set the API or worker login as schema owner. `PORTALS_DATABASE_URL` is mandatory; there is no fallback to the application's unrelated database.

Use a dedicated schema (default `portal`) with identical `PORTALS_DATABASE_SCHEMA` in all four environments. The API can insert signed spell intake and author links and read public/worker state. The worker can update its jobs and durable transaction journal, but cannot alter the ledger. The ledger can update only its event/projection tables. The API cannot read signed transaction bytes. Migration privileges are never loaded by long-running services.

Set `PORTALS_LOG_BLOCK_RANGE` to the lowest historical-log range supported by every configured RPC (1–2000; default 2000). The ledger, grading ingestor and RPC preflight use the same bound. Smaller ranges preserve all events and advance the canonical cursor in more chunks; they do not change confirmation requirements. Run preflight with the actual service configuration before activation.

## Stored-spell acknowledgements

The API verifies the player's existing signed upload, commits it with PostgreSQL `synchronous_commit=on`, re-reads and verifies the stored preimage, and checks a fresh eligibility/price/competition quote before signing an EIP-712 `StoredSpell` receipt. Maintain normal PostgreSQL durability (`fsync` enabled), persistent storage and restore-tested backups; an acknowledgement cannot compensate for losing accepted data. The receipt binds the complete admission, wallet, chain, grading proxy and competition quote. Its expiry is at most five minutes and no later than the player's signed expiry or portal-window end. The frontend refreshes it after USDC approval, then passes `{ expiresAt, signature }` as the final argument to `admit` or `admitCompetition`. There is no extra blockchain transaction or extra player signature for this server receipt.

All admission paths require the receipt. The old function selectors no longer accept submissions; `admitFor` remains callable only by the proxy itself. Revoking `INTAKE_ROLE` invalidates outstanding receipts. The grading contract still independently checks ownership, gates, nonce, artwork, current round and prices. The receipt prevents a caller from paying with a commitment whose spell was never uploaded; it does not guarantee availability of AI providers or remove the trusted intake/grader service. No grading timeout, refund or fabricated fallback score is introduced.

For an existing deployment, prepare a separately reviewed **grading implementation upgrade and intake-role grant**; do not rerun initial setup or redeploy the stack. `PortalGradingValidator` is a stateless helper created by the implementation constructor and bound immutably into that implementation. Verify both source/runtime artifacts, resolve immutable references against that deployed helper, preserve the existing storage layout, and reconcile pending requests before activation. The validator also preserves the previous result/URI checks to keep the grading implementation within EIP-170. Deploy the matching API/frontend only after verifying `intakeVersion() == 1` and the new role. Already accepted requests retain their original bindings and completion path.

Portal rotation remains independent: each activated portal lasts 660 seconds; a competition collects 111 admissions across any number of portal windows/kinds. A new portal does not reset a batch. A full batch waits for grading/theme readiness, while portal rotation can continue. Do not switch to submission-count rotation or dynamically change the batch size.

The ledger records the competition address used for each cursor. It resolves the confirmed binding before scanning earlier ranges, including the opening theme emitted during competition initialization. A newly linked competition or an old cursor without this source identity triggers a canonical replay. Run the migration before restarting the API/ledger, and wait for their indexed readiness checks; accepted spells and worker jobs are preserved.

## Theme publication checks

Generated and resumed theme titles, briefs and contribution explanations must be printable creative text with no links, markup, addresses, credential requests or wallet/payment instructions. The publisher validates again before creating/signing a publication. Unsafe unsigned saved output is discarded and regenerated; after three validation rejections, inspect the private job and winning sources instead of repeatedly calling the model. Never delete a saved transaction: already submitted unsafe output is retained for reconciliation and operator review. Published onchain themes remain immutable. The check is deliberately deterministic and does not change the committed extraction prompt, grading rubric or model policy.

The v5 ledger migration requires replay of earlier projections. The ledger detects an older projection version, rotates its generation, clears its own derived data and replays from `PORTALS_LEDGER_START_BLOCK`. Accepted spells, provider results, signing attempts and publications are preserved. Older completed publications without a slab are requeued for display reconstruction from their canonical result and saved artwork. This path makes no AI call or chain send; it retains original publication timestamps and copying eligibility. Keep the corresponding historical policy worker available until those display jobs finish. Keep the API's entry feature disabled during initial catch-up; replay does not extend an onchain portal window.

## Artifact ownership and serving

Provision an artifact directory owned by the worker and a dedicated group containing the API user, mode `2750`. Set `PORTALS_ASSET_SHARED_READ=true` in the worker. New files are written atomically with mode `0640` and inherit the directory's group. The API has read/traverse access only. Existing `0600` files need an explicit operator-controlled group/read-permission conversion before separate users can read them. The default remains private `0700`/`0600` for single-user operation.

Do not configure a static web server for this directory. Only the API's hash-addressed asset route serves artifacts, after checking indexed and canonical publication. Raw drafts, pending spells and signed transactions are never exposed. Raw edited artwork remains the regrading input; the deterministic PNG slab and its JSON manifest are separate display artifacts.

Proxy the API over HTTPS and apply request rate limits, body limits and connection limits at your ingress. Forward `/v1/portals` without rewriting its asset prefix. Use exact frontend origins, not wildcard CORS. `/healthz` proves only that the process is running; `/v1/portals/health` reports canonical ledger readiness, lag, queued/retrying work, oldest accepted work, delayed publications, portal/prize reserves and liabilities, challenge phase and optional public signer-gas balance. It contains no spell or error bodies. Inspect systemd status separately to establish that a worker is enabled and alive.

## Before enabling admission

1. Check every RPC's chain, historical calls/log ranges, known receipt and missing receipt behavior with `portals:preflight-rpc`. Use a known successful transaction from this deployment as the probe. This command neither signs nor calls AI. Provider authorization errors must never count as missing transactions.
2. Run the full migration, verify runtime grants and back up the database. Confirm worker write/API read access with disposable artifacts. Do not test by publishing a private draft.
3. Start the ledger, wait for the correct deployment's cursor to catch up, then start the API with entry disabled. Validate the deployment bindings and asset paths against private operator records.
4. Start the worker only after checking the authorized signer, GRADER/THEME roles, all retained policy hashes, gas balance, safe confirmations and backup recovery. A missing result transaction must be reconciled with the persisted signed bytes, not replaced by a guessed nonce. A consumed nonce with no matching receipt needs operator investigation.
5. Complete audit review and the separately authorized onchain activation/airdrop. Enable the app only when the operational and public-chain prerequisites are satisfied. Pausing the frontend/API does not cancel accepted paid jobs; keep their workers and artifacts available.

## Backup and restore

Back up the entire portal schema with `pg_dump --format=custom --schema=<schema>` and the artifact directory to encrypted operator storage. Protect the dump like signing material: the worker transaction journal contains signed transactions that can be rebroadcast. Do not put dumps, spells, credentials or receipts in the repository or CI artifacts. Back up role definitions and environment configuration separately through the operator's secret-management process.

Take an initial database dump, copy artifacts, then take a final database dump and repeat the incremental artifact copy. Provider artifacts are written before their publication rows; the final copy must include every hash referenced by the final dump. For a strict point-in-time restore, stop the worker and ledger gracefully before the final dump/copy. Restore into a fresh database/schema, restore artifacts with their ownership/modes, run migrations/grants, and verify referenced files before restarting workers. Run the ledger's canonical checks/replay before enabling the UI. Retain the original signed transaction identities, request bindings and generated results.

`pnpm --filter @protopals/yunipals-indexer test:portals:postgres` performs a disposable real PostgreSQL drill covering repeat migrations, restricted runtime users, concurrent leases, signer advisory locks, crash persistence, atomic ledger rollback and `pg_dump`/`pg_restore`. It accepts only a loopback test database named `portal_test`; use `PORTALS_TEST_DATABASE_URL`. It must never be pointed at a production database. The test also needs `pg_dump` and `pg_restore` of a compatible major version (or its explicit test-container option).

## Guided airdrop

`/portals/airdrop` guides the admin through recipient review, mint commitments, VRF readiness, delivery in groups of up to 32, and the first portal rotation. `/portals/admin` retains the other configuration actions and links to this guide. Every step waits for confirmed, indexed events before enabling the next action.

Prepare an operator-owned JSON allocation with these fields:

```json
{
  "version": 1,
  "title": "Portal holder airdrop",
  "chainId": 8453,
  "collection": "<collection proxy address>",
  "admin": "<admin wallet address>",
  "kindId": "1",
  "kindConfigurationHash": "<current getKind configurationHash>",
  "snapshotAt": "<ownership snapshot ISO timestamp>",
  "expectedAllocated": 0,
  "batches": [{ "recipients": ["<recipient address>"] }]
}
```

Use current, verified ownership and staking beneficiaries. Preserve repeated addresses: each entry receives one NFT. Each batch allows at most 100 entries; the full allocation must fit the kind's remaining lifetime cap. `expectedAllocated` is the kind's allocation before the first commitment, not its delivered supply. The guide binds every batch to its exact serial range and ordered recipients and refuses unexpected allocation or configuration changes.

Import the JSON in the browser, or publish it as an immutable public file on the app origin or configured portal API origin. Link to `/portals/airdrop?manifest=<URL-encoded file URL>&sha256=<SHA-256 of exact file bytes>`. The URL checksum is mandatory; redirects are rejected. Only public allocation data belongs in this file. Keep actual recipients, deployment addresses, snapshots and transaction evidence in private operator records, outside this repository.

The guide saves a wallet intent before requesting a signature and resumes from onchain requests plus indexed progress after reload. A rejected signature unlocks the step; an ambiguous wallet response keeps it locked. Use **Check saved transaction** with the original transaction hash to reconcile an unresolved attempt. The transaction must match the saved sender, target, nonce and calldata. Do not clear browser storage or start a replacement allocation to bypass an unresolved request. If its hash cannot be recovered, reconcile the wallet's activity and chain state before any further mint commitment. Separate browsers or devices do not share this local signing lock; use one admin signing session at a time.

## Recovery and rollback

If a service fails, preserve its data and restart the same release/configuration after fixing the cause. Persisted signer attempts prevent another operation from taking an unresolved nonce. The worker's exact signed bytes can be rebroadcast; timeout and RPC denial are not failure receipts. A higher-fee replacement requires a reviewed operator recovery procedure matching the original intent and reconciliation of the journal before resuming. Do not manually delete rows to make a nonce available.

An application rollback preserves accepted jobs, signing attempts, schemas and artifacts. Never run an older worker against a newer journal it does not understand. Never delete the new indexed projections to avoid a UI wait: a replay resets the generation and clients resume their saved checks. Onchain upgrades and already-paid requests cannot be rolled back by replacing frontend files. A grading delay has no automatic refund or expiry under the agreed product rules.
