# Yunipals implementation checklist

Last checked: **23 October 2026, 00:52 UTC**.

**The collection and public booster packs are live together at [www.yunipals.com](https://www.yunipals.com/).** Old app links redirect to the matching www route. The remaining migration moves the existing services onto the single managed indexer. Dashboard maintenance is dropped; this file is the concise status checklist.

## Delivered

- [x] Restore the public collection and verify desktop/mobile viewing.
- [x] Consolidate packs into the complete existing main-domain app, preserve original menus/features, verify real API/wallet/artwork/holo/mobile flows, and redirect the old app hostname. The initial collection-only regression was corrected; live8/8 original-feature checks passed.
- [x] Publish frontend, contracts, indexer, artwork generator, required references and deployment source in the existing [public repository branch](https://github.com/protocolmon/yunipals/tree/codex/indexer-monorepo). Source baseline commit `b270265` also preserves the exact historical runtime baseline, corrected fixture and rebuild/install operators; main-branch reconciliation remains separate.
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

- [ ] **Complete historical replay.** Running on the same normal free-only source. Latest verified BNB checkpoint: **60,068,440** at 00:52 UTC (about **43.2%** of the required historical block range; fixed target 129,172,539). This measures block coverage, not elapsed-time completion. The same live process has no recorded OOM events and the 25 GB disk reserve remains intact. Complete history and current canonical coverage across all four EVM chains remain unproven.
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
- [x] Apply Arena operational schema maintenance. All 12 official migration markers, preserved payloads and original functions/triggers passed the production postcheck; the local backup remains retained. The schema change is committed.
- [x] Verify Arena runtime-only recovery. The candidate exposed a production rules-manifest mismatch after startup. Only its eight owned overrides were removed; the original workers are restored with the same keys/configuration. All eight remained active, and health/config/rules endpoints returned HTTP 200 with the original production rules hash. No schema or private-data restore was performed.
- [ ] Finish and deploy the Arena compatibility update. The original production workers continue serving; the replacement has not been deployed.
  - [x] Restore the actual production catalog, rules hash and existing API/artwork/funding behavior in the isolated candidate.
  - [x] Implement native public history, wallet summaries, rewards and island/timeline views, without falling back to legacy public projection tables.
  - [x] Pass all 21 independent offline protocol/API acceptance checks.
  - [x] Pass the real PostgreSQL native read-model checks, including canonical-source checks and exclusion of stale private enrichment.
  - [x] Finish the remaining integration fixture and run the final combined typecheck, regression tests and 36-bundle build after the code is frozen. All 213 regression tests passed; all 236 bundled source contents match the final source.
  - [x] Verify the existing 898 local island PNGs against their metadata hashes. Production asset attachment and rendering remain separate checks.
  - [x] Publish the reviewed replacement source and complete public dynamic inputs. Commit `438bc23` is pushed to the public branch; the finite source and archives passed the secret scan.
  - [x] Verify all 903 retained production public assets: 898 island PNGs, four fighter references and the soundtrack match the published hashes. The four retained offline Python media scripts also match the installed candidate; imports, font access, ffmpeg and ffprobe passed under the existing media worker's UID and mount namespace. This does not claim a new runtime attachment or production film rendering.
  - [x] Pass the current-code genuine contract/Ponder/private-worker lifecycle, selected-source recovery and same-process reorg checks. Real local film assembly, settlement and claims passed; providers, NFT ownership and VRF responses remain explicit fixtures. All owned processes and fixture namespaces were cleaned up.
  - [x] Pass 13 actual PostgreSQL groups under eight dedicated nonowner worker roles. The finite grant omissions were identified and tested; this is local proof, not production role admission.
  - [x] Build, verify and install the offline deployment package using the retained dependency set and a separate relocated rebuild. Both sets of 79 credential controls and 21 protocol checks passed; the independently rebuilt runtime archives match. The actual fresh inactive install verified all 1,796 source files and 60,922 runtime entries; no running service or source selection changed.
  - [x] Qualify the installed candidate's constructor in the actual retained credential contexts. The production API check and subsequent all-eight check passed with nine total bounded Base read calls, read-only database sessions and successful close. Original actors, configuration, twelve schema markers and legacy selection remained unchanged. Worker startup, dedicated-role authentication and native adoption are separate checks.
  - [ ] Admit and qualify the dedicated production source and operational roles. The commit and credential helpers, independent review and real PostgreSQL controls are complete; the fresh production commit review also passed. The earlier production rollback rehearsal covered both databases. Actual COMMIT was rejected by automatic approval review before execution because this exact nine-role/240-grant scope needs explicit approval. The bundled role/credential-setup question is pending. No persistent grants, LOGIN changes or private overlays have been applied; no migration rerun is needed.
  - [ ] Finish the direct native cutover against the already committed schema, deploy the replacement, then verify sustained startup and public API compatibility. Its initial implementation and independent review passed 15 Python controls, eight Node controls and real PostgreSQL migration/adoption/source-selection checks, including two lost commit acknowledgements. Explicit forward continuation after a partial cutover is being completed; its final wiring and tests remain. The cutover binds the actual installed package, role/authentication receipts and current canonical source. Existing workers serve until that cutover.
- [ ] Adopt the compatible Arena workers onto native Ponder state, then verify accounting and recovery. The operational schema prerequisite is complete; native adoption is not. Do not rerun the completed owner migration.
- [x] Publish the latest build corrections and exact historical source baseline. Commit `b270265` is pushed to the public branch; all 1,746 archived source hashes were verified and the extracted contents and current source corrections passed secret scans.
- [ ] Compare public APIs, collection filters, metadata, rarity, search and Solana responses against their retained baselines.
- [ ] Rehearse the coordinated source/worker rollback on the actual replacement deployment. Arena runtime-only recovery has passed; the combined source and consumer rollback is still pending. A separate post-native Arena rollback is being designed to use an isolated public projection while retaining native private workers and records; its owner/tests and isolated target permissions are not yet prepared.
- [ ] Observe at least 24 hours, including a supervised restart, backup and idle cycle.
- [ ] Disable every superseded scanner and its restart paths; finalize the operating runbook.

## Waiting or deferred

- [ ] **First genuine daily mainnet claim:** owner test after **23 October 2026, 17:33:29 UTC**. The elapsed-time requirement cannot be established by a fork test.
- [ ] Genuine accumulated-batch mainnet observations. Existing fork tests cover the rules, but elapsed live days remain separate evidence.
- [ ] **Unattended artwork generation:** the durable artwork queue runs, but new variant images currently require manual generation and review. An unattended provider worker remains unconfigured; missing images can show as pending.
- [ ] Marketplace receipt history, sales/listings/cancellation parity and marketplace consumer cutover. **Held behind the shared collection reader work.** The receipt worker remains stopped.
- [ ] Additional exhaustive live reorg stress scenarios, deferred as agreed. Basic native canonical handling and rollback checks remain part of acceptance.

**Next concrete deliverable:** complete and test the direct cutover's forward continuation, alongside the post-native rollback implementation, while the role/credential approval is pending. The initial cutover tests/review, package install, all-eight constructor checks, eight unit-definition checks and production permission rollback rehearsal have passed. Shared collection reader switches remain queued behind replay. No further pack configuration or activation signature is needed now.
