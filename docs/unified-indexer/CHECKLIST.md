# Yunipals implementation checklist

Last checked: **22 October 2026, 21:33 UTC** (Arena compatibility preflight; replay point below remains timestamped separately).

**The collection and public booster packs are live together at [www.yunipals.com](https://www.yunipals.com/).** Old app links redirect to the matching www route. The remaining migration moves the existing services onto the single managed indexer. Dashboard maintenance is dropped; this file is the concise status checklist.

## Delivered

- [x] Restore the public collection and verify desktop/mobile viewing.
- [x] Consolidate packs into the complete existing main-domain app, preserve original menus/features, verify real API/wallet/artwork/holo/mobile flows, and redirect the old app hostname. The initial collection-only regression was corrected; live8/8 original-feature checks passed.
- [x] Publish frontend, contracts, indexer, artwork generator, required references and deployment source in the existing [public repository branch](https://github.com/protocolmon/yunipals/tree/codex/indexer-monorepo). Source commit `e814509`; main-branch reconciliation remains separate.
- [x] Deploy, audit and BaseScan-verify the booster contracts.
- [x] Activate the unlimited public pack: 1 PROTO, 264 variants, one mint credit per 24 hours, no speed boost.
- [x] Verify a genuine mainnet purchase: full PROTO burn, successful Chainlink VRF callback, original NFT and remaining collection rights.
- [x] Publish the first revealed card with the approved artwork and interactive foil viewer.
- [x] Add the branded lavender booster wrapper and Protobits-style tear, extraction and reveal to the existing www app. Wallet-free preview, six component checks, eight staged original-feature checks and five live site checks passed. Grading now uses an inspection icon; Collection keeps owned monsters without the purchase section.
- [x] Implement and test the shared Ponder handlers, native Arena indexing and supervised Solana adapter.
- [x] Complete the full database backup/restore rehearsal and recovery supplement.
- [x] Run the deployed-contract fork checks for daily accrual, duplicate-free batches, transfer, burn and lost-VRF recovery. Genuine elapsed mainnet claims remain below.

## Working now: finish the shared collection readers

**Running:** normal historical replay. **Prepared in parallel:** reviewed handover code and recovery paths, now staged on production. The metadata/cache/reader changes below wait for real native readiness; their live switches have not started.

- [ ] **Complete historical replay.** Running on the normal free-only source. Latest verified BNB checkpoint: **42,167,540** at 21:18 UTC (about **28.4%** of the required historical block range; fixed target 129,172,539). This measures block coverage, not elapsed-time completion. Complete history and current canonical coverage across all four EVM chains remain unproven.
- [x] **Clear the reader permission-history mismatch.** The corrected verifier passed against production at 19:27 UTC, recognizing the already admitted reads and preserving the older metadata permissions. No new permissions or service changes were needed.
- [x] **Provide cache-build disk capacity.** Completed at 19:33 UTC: copied and verified the seven-file September 30 cold backup, then replaced its two large originals with verified volume links. Reclaimed 7.61 GB; root now has approximately 46.88 GB available. All old paths still resolve; the current October 20 recovery set was untouched.
- [ ] **Adopt native metadata provenance and publication.** Waiting for replay and the first current native block witnesses. Actual readiness probes reject the historical source with `indexer_not_ready`; this is expected catch-up gating. The legacy metadata worker continues producing the active data.
- [ ] **Build and accept the new collection/rarity/search generation.** Queued behind native metadata readiness. Current generation 103 still lacks the required shared-source identity; no replacement build has started.
- [ ] **Apply the native cache guards.** The exact transition passed a rollback rehearsal; the live guards still reference old physical sources.
- [ ] **Switch staking verification.** Native worker is installed but dormant. Complete the first native verification and enable its existing five-minute schedule.
- [ ] **Pass the three replacement API previews and four reader/cache installs.** Required helper files are staged; actual acceptance and service switches remain pending.

## Then complete consolidation

- [ ] Compare temporary and shared booster data at a common canonical boundary; switch the booster API and artwork queue. The corrected handover passed independent review and its production seven-read rollback rehearsal at 19:42 UTC. Actual committed-read acknowledgement, four reader admissions and the live switch remain pending.
- [ ] Observe a genuine newer booster event on the shared source, then retire the temporary booster scanner.
- [ ] Move EVM ingestion and the Solana adapter under the single managed service; verify scheduled Solana publication and restart behavior. All final public handover artifacts are staged with exact dependency and successful rollback-receipt checks. The v2 supervisor also retires the four old boot links before shared startup;65behavioral and10stager controls passed. The final service has not been started.
- [ ] Adopt the production Arena workers with the existing approved configuration; verify accounting and recovery. Actual owner preflight found and corrected the retained OS GID, then exposed a replacement-runtime incompatibility with systemd read-only credentials. The application reader fix and exact consumer rebuild are now in progress; no workers or database have been changed.
- [ ] Compare public APIs, collection filters, metadata, rarity, search and Solana responses against their retained baselines.
- [ ] Rehearse the coordinated source/worker rollback on the actual replacement deployment.
- [ ] Observe at least 24 hours, including a supervised restart, backup and idle cycle.
- [ ] Disable every superseded scanner and its restart paths; finalize the operating runbook.

## Waiting or deferred

- [ ] **First genuine daily mainnet claim:** owner test after **23 October 2026, 17:33:29 UTC**. The elapsed-time requirement cannot be established by a fork test.
- [ ] Genuine accumulated-batch mainnet observations. Existing fork tests cover the rules, but elapsed live days remain separate evidence.
- [ ] **Unattended artwork generation:** the durable artwork queue runs, but new variant images currently require manual generation and review. An unattended provider worker remains unconfigured; missing images can show as pending.
- [ ] Marketplace receipt history, sales/listings/cancellation parity and marketplace consumer cutover. **Held behind the shared collection reader work.** The receipt worker remains stopped.
- [ ] Additional exhaustive live reorg stress scenarios, deferred as agreed. Basic native canonical handling and rollback checks remain part of acceptance.

**Next concrete deliverable:** accepted shared collection readers. No further pack configuration or activation signature is needed now.
