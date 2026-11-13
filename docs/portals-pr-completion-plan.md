# Portal app completion through pull request

The [shared-indexer migration plan](unified-indexer/portals-migration-plan.md) supersedes this document's original standalone public-ledger architecture. Production must select the shared portal projections and indexed job consumer after qualification. Keep the separate database for private operational state; the legacy scanner is temporary rollback/rehearsal support only.

Plan date: 12 November 2026.

Complete the portal experience across contracts, API, workers, indexing, artwork, wallet flows and the existing TCG frontend, then open a tested pull request. This plan builds on the implemented [product specification](portals-implementation-plan.md), [burn-to-claim specification](portals-burn-to-claim-plan.md) and [operation runbook](portals-runbook.md). Preserve their agreed product behavior.

The endpoint is a reviewable PR with reproducible checks and a concrete activation procedure. Opening the PR does not require an airdrop, paid mainnet test or completion of the external audit. Public activation follows audit review and operational readiness. This document plans the work; it does not record its completion or authorize a production transaction.

## Scope and existing baseline

Include portal TCG NFTs, onchain card traits/gates, the global eleven-minute portal, AI artwork and grading, originality handling, per-portal fee accumulation and owner burn-to-claim, competitions, winner-derived themes, metadata/history, administration and integration with the rest of the TCG app.

The core implementation already exists. The frozen review snapshot passed 154 Solidity tests and 53 backend tests, both application type checks, frontend build, storage checks and release size checks. Eight public-network fork tests were opt-in and skipped. Existing local browser coverage and earlier live Sepolia evidence remain useful; the live eleven-card run predates sequential themes and must not be described as a full current-version rehearsal.

Read the private operator handoff before production work. Existing deployment/upgrade/import transactions have separate verified records; reconcile them instead of repeating deployment. Preserve the auditor's frozen archive. Track subsequent changes against that source, and request review of relevant fixes rather than silently replacing the audit target.

The current checkout also contains work on collection grouping, pack/wrap UX, profiling and review automation. Treat those changes as independent unless a specific portal dependency is established. The existing workspace must remain intact.

## 1. Isolate the PR source and establish its baseline

1. Inventory tracked and untracked changes and classify portal source, required integration changes and unrelated work. Check the latest base branch and existing PRs before preparing the branch.
2. Prepare an isolated checkout based on current `main`, with a `codex/` branch. Transfer only the required files and hunks, including portal package exports, dependencies, public artwork, route registration and tests. Resolve shared-file changes explicitly rather than copying unrelated features into the PR.
3. Verify the isolated checkout builds independently of ignored files and the original working directory. Include required test fixtures and licenses. Check ABI generation and compatibility with the verified deployed implementations.
4. Keep real environments, signing keys, hostnames, SSH details, production receipts, recipient lists and the auditor ZIP in private operations storage. Track only generic templates and reusable source in the application repository.

**Completion:** a reproducible portal branch, a source-to-audit comparison and an explicit dependency list, with other workspace work preserved.

## 2. Complete RPC and transaction recovery

The worker currently uses a single RPC. A public provider tested during preparation accepts historical logs but rejects nonexistent receipt lookups with an access error. Provider errors must not be interpreted as evidence that a transaction is absent.

1. Add a read-only preflight for chain identity, deployed contract bindings, historical state, actual log range requirements, known receipts and genuinely missing transaction/receipt responses. It must not call paid AI, mutate a database or broadcast transactions.
2. Configure a compatible primary RPC and a separately checked fallback. Keep credentials private; use bounded retries, backoff and appropriate log range limits. Pin related reads to a consistent canonical block.
3. Distinguish pending, confirmed, reverted, replaced, genuinely missing and provider-unavailable states. A delayed response is not permission to submit a new paid action.
4. Close transaction persistence gaps around worker broadcasts. Retain the intended chain, signer, nonce, payload and signed transaction before broadcast where needed; reconcile on restart and rebroadcast the same transaction when appropriate. Preserve generated artwork and scores across recovery.
5. Coordinate the grading wallet's nonce across grading, deferred competition notifications, theme publication and any retained-policy workers. Ensure only one process owns a broadcast attempt, even after lease expiry or restart.
6. Add targeted tests for access-denied errors, timeouts, inconsistent providers, replacement/cancellation, a process dying after broadcast, and canonical receipt changes. Do not weaken the existing checks just to accommodate a provider.

**Completion:** delayed or dropped grade/theme transactions recover without duplicate work, lost results or guessing that an RPC error means absence.

## 3. Finish database, services and configuration

1. Prepare a dedicated portal database or schema and separate migration/runtime privileges. The API needs limited writes for signed spell intake and author links; it is not a read-only database client. The grading worker writes jobs/publications/themes, while the public ledger writes its own event projections.
2. Exercise initial and repeat migrations on real PostgreSQL, including existing rows, interrupted execution, concurrent workers and restart. Verify schema/search-path selection and deployment namespaces. Never silently fall back to an unrelated application database in production.
3. Package the portal API integration, grading/theme worker and public ledger as reproducible releases with generic service templates. Include explicit worker enablement, startup checks, process ownership, graceful shutdown and restart behavior. The API feature flag alone does not stop a worker.
4. Use the API entry point that mounts portal routes; adding settings to the separate booster API is insufficient. Verify existing API routes continue to work.
5. Load the existing AI and grading credentials only into the worker. The API, ledger and frontend must not receive those keys. Validate the signer address, roles, policy hash, deployment addresses and start blocks without logging secrets.
6. Define and test worker-write/API-read permissions for artifacts. Current private file modes need deliberate treatment if services run under different users. Public routing must expose only confirmed publications, never the entire private artifact directory.
7. Add database and artifact backup/restore instructions and run a disposable restore drill. Verify queued requests, saved provider results, transaction identities, leases and ledger cursors survive recovery.
8. Add useful readiness and operational signals: worker and ledger lag, oldest accepted request, retry state, RPC health, signer gas, publication delay, pending themes and unpaid liabilities. Health output must not reveal private spells, secrets or provider request bodies.

**Completion:** an isolated deployment can start, stop, resume and restore the complete runtime using documented settings, without enabling public admissions.

## 4. Make indexed completion mandatory in the frontend

This is an explicit product requirement: portal transactions must use the same receipt-to-indexed-result behavior as the rest of the frontend. A successful receipt followed by one `refetch()` is not sufficient.

Reuse the existing transaction persistence and action-evidence conventions in `arenaTransactions.ts`, booster request/reveal handling, the marketplace indexed-action helpers and the shared `indexedAction` types. Extend reusable primitives with a portal event/projection adapter; preserve existing consumers. The portal ledger is a separate data source, so a different indexer's watermark cannot prove that portal data is ready.

### State and evidence requirements

- Retain transaction state through `submitted → confirming → indexing → indexed`, with explicit delayed, failed and inclusion-changed handling. Persist sufficient identity to resume after navigation or reload, scoped to chain, deployment, wallet and action.
- Bind completion to the canonical transaction hash, block number/hash, emitting contract, expected event/log identity and expected entity IDs. The relevant indexer must have processed the block and applied the matching projection. An advancing head alone, an old matching row or a different wallet's event must never satisfy completion.
- Add typed API evidence for portal actions. Extend event ingestion for currently missing grading, theme, mint-request and configuration events as required. Return source identity, cursor/anchor and application status; do not fabricate indexed evidence from a live RPC response.
- Keep confirmation, indexing and AI work distinct. A submission can be accepted and indexed while its image is still being generated. A grade can be confirmed onchain while its public report, image and history are still being published.
- During indexing delay, show progress and the existing transaction; keep polling with bounded backoff and retain resumable state. Do not clear the transaction, announce the final state or invite a duplicate payment. If observation times out, keep a delayed state and a retry-status action.
- Handle wallet/network changes, transaction replacement and reorgs. Invalidate evidence from the old block or source generation, return to the appropriate pending state and reconcile affected queries.
- Refresh the relevant queries when qualified evidence arrives. Prevent stale pages from restoring old ownership, balances, versions, fees, themes or prize states after completion.
- USDC approval follows the app's existing receipt plus fresh allowance check. Do not invent an indexed-approval dependency where the application does not index approvals.

### Action coverage

| Flow                                   | Required completion evidence                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spell submission and competition entry | Canonical admission and entry events, correct request/entry IDs, indexed accepted-request/competition data; show grading as a subsequent phase                        |
| Grading completion                     | Exact result event and artwork version, canonical published report/image, matching indexed history and competition score                                              |
| Burn-and-claim                         | Expected claim/burn events, retired portal ownership projection, recorded paid amount and updated claim history; retain any separately refreshing live balance status |
| Portal transfer observed by the app    | Indexed ownership and history for the exact transfer; never offer a stale owner an action based only on cached API data                                               |
| VRF rotation                           | Indexed request first, then fulfillment/readiness, then activation and indexed round; requesting randomness is not activation                                         |
| Mint/airdrop                           | Indexed mint commitment, then fulfillment and actual minted-token/ownership events for each finish chunk; a request receipt is not completed delivery                 |
| Competition settlement or prize retry  | Indexed settlement and individual paid/deferred events; a settled batch does not mean every prize transfer succeeded                                                  |
| Next theme                             | Canonical theme publication plus matching published artifact and API theme/admission state; grading, prize payment and next-theme readiness remain separate           |
| Admin kind/fee changes                 | Matching configuration/version events and refreshed API projection; show that updated fees apply to future requests                                                   |

The chain still decides admission validity. Indexing delay must never extend an expired eleven-minute window or bypass a fresh quote/gate/ownership check. A public settlement path can remain available during API trouble using direct chain verification, while clearly retaining “confirmed, indexing” status for history that has not caught up.

**Completion:** delayed-indexing browser tests prove that every relevant portal action stays pending until its exact event and resulting data are available. Cover reload during indexing, stale caches, out-of-order API responses, source-generation changes and reorg replay.

## 5. Complete artwork, slabs and metadata publication

1. Reuse the approved Rainbow artwork and existing per-kind slab renderer. Graded slabs are already shown in app history; the NFT metadata endpoint still uses the raw artwork URI. Finish deterministic, versioned slab publication for completed card metadata.
2. Preserve the raw, hash-committed edited image as the next grading input. A display slab must never become the next AI input or overwrite historical image bytes. Preserve original metadata behavior for ungraded cards.
3. Bind slab content to the exact card, artwork version, portal kind and four onchain grades. Produce stable, content-addressed output with a rendering-version identity and distinguish its hash from the raw artwork hash.
4. Make metadata/history, completed spell text, originality evidence, grade explanations and theme artifacts available only under the appropriate confirmed publication state. Ensure a renderer failure is retryable without another AI edit or another grade submission.
5. Verify HTTPS paths and prefixes, allowed source-art hosts, content types, cache behavior, hash integrity and external wallet/marketplace image loading. Refresh latest metadata while retaining immutable historical assets.
6. Preserve historical results for cards transferred or burned during a pending grade. Verify the intended distinction between a burned token's metadata endpoint and the public grading-history view.

**Completion:** the same completed result appears consistently in the app, NFT metadata and downloadable slab, while regrading uses the correct raw image version.

## 6. Finish the full player and administrator journeys

1. Review the active-portal view, countdown, card selection, gate explanations, latest artwork selection, spell entry, quote review, USDC approval and submission as one journey. Recheck round, fee version, card ownership, input version and theme immediately before admission.
2. Make the 0.99 USDC Rainbow split, four score categories, copying impact, unlimited regrading and sequential challenge behavior clear in the existing UI. Preserve the agreed economics and rubric.
3. Apply the indexed-completion states from section 4 throughout submission, history/slabs, My portals, owner claim, competition leaderboard/prizes, theme waits and administration. Avoid isolated success notices that leave surrounding data stale.
4. Verify permissionless rotation/activation, competition settlement and deferred-prize retry. Show gas/payment review and partial outcomes accurately.
5. Verify admin role restrictions, kind creation, capped mint lists with repeated recipients, resumable finish chunks, pricing changes and configuration changes during a user's pending quote.
6. Check mobile layout, keyboard access, wallet cancellation, wrong chain/account, insufficient gas/USDC, closed windows, no live portals, unavailable indexer and slow publication. Preserve in-progress spells without exposing them to unrelated users or logging them.
7. Test integration with collection cards, collector ownership/balances, pack opening, token-detail views and wallet navigation. Integrate any needed shared components without bundling unrelated product work.

**Completion:** each user journey works from navigation through indexed/public completion, with understandable waiting and recovery states.

## 7. Add release checks to CI and validate the PR checkout

1. Keep the existing repository CI checks. Add explicit Solidity release-profile tests, legacy/portal storage compatibility, bytecode-size checks and ABI consistency. Pin the required tool versions consistently with the verified build.
2. Run portal backend and frontend state-machine tests, including the indexing/recovery failures added above. Add real PostgreSQL migration, grants, lease and ledger-transaction coverage where the current embedded-database tests do not establish production behavior.
3. Run a deterministic browser-to-API-to-database-to-contract flow on Anvil with mocked AI/VRF and genuine transaction receipts. Exercise a complete 111-entry competition, exact reserve/payout accounting, delayed indexing, sequential theme opening, claims and post-transfer/burn grading.
4. Include publication/slab checks, wallet replacement/cancellation, reload recovery, outage/reorg scenarios and proof that no partial indexing result is presented as complete. Capture useful desktop/mobile failure artifacts in CI.
5. Run relevant existing booster, collector, marketplace and Arena regression checks for any shared primitives touched. A generalized transaction helper must preserve their existing indexing guarantees.
6. Run the normal repository typecheck/build and required CI jobs from the isolated PR checkout, not only from the original dirty workspace or the earlier audit archive. Scan the diff for secrets, operator records and accidentally copied artifacts.
7. Keep paid AI and public-chain sends out of default CI. Retain optional fork/network checks with clearly identified prerequisites. Another full paid Sepolia rehearsal is not a requirement for this PR; the existing user preference is to finish remaining live acceptance on mainnet after readiness.

**Completion:** CI is green for the exact PR revision, with test evidence distinguishing simulated behavior, historical live evidence and remaining live acceptance.

## 8. Reconcile audit findings and prepare the launch handoff

1. Track external audit findings against the frozen review source. Add focused regression tests for accepted fixes, record dispositions and provide the auditor with the changed-source comparison for retest.
2. Avoid changing deployed Solidity without a specific need. If a required fix changes it, prepare a separately reviewed upgrade: storage and size validation, fork simulation against current state, source verification and user-signed execution. Application fixes alone do not require redeploying the stack.
3. Update generic implementation status and runbooks so they describe current code and its prerequisites without stale blanket statements about production deployment. Keep actual production state, addresses, signers and receipts in private operator records.
4. Prepare a private activation checklist covering schema migration, artifact storage, runtime configuration, service health, index catch-up, read-only deployment checks, feature enablement and an application rollback that preserves accepted jobs.
5. Prepare the final airdrop procedure: refresh OG ownership and staking beneficiaries at execution, preserve one entry per holding and repeated wallet addresses, reconcile unresolved classification, generate bounded mint batches and verify actual deliveries. Do not freeze the earlier provisional count as a new ownership snapshot.
6. Plan controlled mainnet acceptance after audit/readiness: user-signed mint commitments, real VRF fulfillment and first rotation, a bounded paid grading through indexed publication, and exact USDC/accounting checks. Use local tests for the full 111-entry boundary; do not manufacture a paid mainnet batch to complete the PR.
7. Document operational responses to indexing lag, provider failure, low signer gas, delayed grading, blocked prize recipients and delayed themes. Pausing admission must not discard existing paid work. A frontend/API rollback does not roll back onchain upgrades.

**Completion:** an actionable handoff with audit status, engineering checks and live activation prerequisites separately recorded. Resolve and retest release-blocking audit findings before public activation.

## 9. Open the pull request

1. Review the final diff against current `main`; reconcile base changes and rerun affected checks.
2. Arrange reviewable commits: existing portal contracts/shared domain; recovery/runtime; indexed action evidence/frontend lifecycle; artwork/metadata and UI integration; tests/CI; deployment-neutral documentation/templates. Keep the final PR cohesive even if the implementation spans several commits.
3. Open one portal integration PR with a description of the resulting player/admin behavior, preserved trust assumptions, existing deployed-contract compatibility, validation results and remaining audit/activation conditions. If an inseparable unmerged dependency is found, make the dependency explicit instead of silently including its unrelated feature work.
4. Attach the created PR to this Codex task. Monitor required CI, fix scoped failures and review the final diff. Keep it a draft only while engineering work/checks are incomplete; an external audit can be tracked as a release condition without preventing code review.
5. Deliver the PR link, exact tested revision, screenshots of the main flows, audit comparison and private activation handoff. Do not merge or activate as part of the “through pull request” endpoint.

**Completion:** a clean, tested PR ready for review, with no missing local files, no secret/operator data, no unrelated working-tree changes and no unreported release blockers.

## Execution order and decisions

Start with source isolation. Complete RPC recovery and backend/runtime foundations next; build portal indexed-action evidence before finishing frontend success states. Artwork publication and UI work then use those foundations. Run the complete isolated integration and CI checks, incorporate available audit findings, prepare the launch handoff and open the PR.

Existing product decisions remain settled: one global 660-second portal; per-kind gate odds; original-only overrides sequence only; Rainbow's versioned image effect and rubric; four 1–100 scores; 0.99 USDC initial total; fee accumulation and owner burn-to-claim; 111 submissions per competition; 50/30/20 permissionless payouts; sequential winner-derived themes; no grading timeout/refund; transfers and unlimited regrading remain allowed.

There are no new product questions required to start this plan. Engineering choices use existing repository patterns. External inputs are the audit findings, a suitable RPC credential only if existing configuration cannot satisfy recovery requirements, and the user's signatures for any later onchain activation/upgrade. These do not prevent the remaining local implementation or PR preparation.

## Execution record — 12 November 2026

Source isolation, recovery/runtime, exact indexed completion, canonical slab publication, player/admin integration and local release checks are implemented. The independent working tree and frozen audit archive are preserved. Generic operations templates and current implementation status document the release procedure. A private source comparison and activation checklist accompany the PR; operator records are excluded from Git.

Local evidence includes the full release Solidity suite, storage/size/ABI checks, 82 portal tests, genuine PostgreSQL migration/concurrency/restore, repository regressions and a browser run through all 111 entries, sequential themes, payouts, indexed claims, mint chunks, staged rotation, token-detail artwork and burned-card history. AI and VRF are deterministic in that browser run.

The PR's required CI is the final engineering check. External audit dispositions and controlled live activation remain separate release conditions; this record does not authorize an airdrop, new mainnet sends, service activation or merging.
