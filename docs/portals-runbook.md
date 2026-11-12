# Portals release and operation

This runbook describes the implemented [product plan](portals-implementation-plan.md), including per-portal USDC accumulation, owner burn-to-claim and sequential winner-themed competitions. Validation includes local theme publication/recovery and an eleven-card live-AI Base Sepolia challenge with verified public payouts. The primary competition flow is permissionless public resolution; no server settlement keeper or CRE deployment access is required. Theme extraction uses the existing AI worker. Deployment/setup may already exist; reconcile the operator records before sending any setup transaction. Historical Sepolia runs predate sequential themes; public application activation requires the readiness and audit checks below. This runbook contains no deployment addresses, signing keys or host configuration. Read the operator's untracked `AGENTS.local.md` before checking or changing a deployed environment. Nothing in the preparation commands below broadcasts a public-chain transaction by default.

For dedicated database roles, service templates, artifact permissions, RPC preflight and restore/recovery, use the [runtime packaging guide](../ops/portals/README.md). Frontend completion requires exact canonical event and projection evidence from the portal ledger; receipts alone do not mean application data is ready.

Follow the [burn-to-claim implementation and release specification](portals-burn-to-claim-plan.md#configuration-and-release-procedure) for the new controller binding, ledger process, owner claim interface, test coverage and revised deployment prerequisites.

## Components

| Component                                               | Responsibility                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `YunipalMonsters` upgrade                               | Immutable underlying traits, family sequence, actual mint time, metadata refresh and grading link                                                          |
| `BoosterPacks` upgrade                                  | Atomically records consecutive offspring sequences with the existing mint draw                                                                             |
| `PortalRules`                                           | Stateless kind validation, gate arithmetic, portal metadata and the same Chainlink proof verification                                                      |
| `PortalCollection` UUPS proxy                           | Kind definitions, fixed gates, committed airdrops, historical/live token indexes, pool checkpoints and restricted retirement                               |
| `PortalRegistry` UUPS proxy                             | The single global 660-second window, staged permissionless VRF rotation and utility selections using immutable pool snapshots                              |
| `PortalGradingCompetition` UUPS proxy                   | Sequential 111-entry batches, immutable themes, separate backed prize reserves, final-score ranking, permissionless settlement and isolated payout retries |
| Optional `PortalCompetitionReceiver` and CRE workflow   | Authenticated ready-event delivery and rotating recovery; no authority to choose winners or amounts                                                        |
| `PortalGrading` UUPS proxy                              | Gate checks, AI payment, backed per-portal USDC balances, owner burn-to-claim, accepted request snapshots and grading history                              |
| Indexer portal API                                      | Private signed spell intake, live contract reads, public completed reports and token metadata                                                              |
| Portal worker                                           | Confirmed event ingestion, durable checkpoints, image editing, originality assessment, onchain completion and winner-derived theme publication             |
| Public portal ledger                                    | Confirmed ownership, fee/claim and round events with independent cursor, atomic projections and reorg replay; no AI/signing credentials                    |
| `/portals`, `/portals/cards/:tokenId`, `/portals/admin` | Entry, versioned artwork/grades and role-controlled kind/airdrop/pricing administration                                                                    |
| `/portals/mine`, `/portals/tokens/:portalId`            | Owned portals, live claimable balances, owner burn-and-claim confirmation and retained public history                                                      |

Portal IDs are `(kind - 1) * 1000 + serial`. Kind settings freeze on its first mint commitment. Prices have a separate versioned policy. After competition binding, Rainbow starts at 245,000 USDC units for AI plus 245,000 units credited to the portal NFT used and 500,000 units paid directly into the competition pool: 990,000 units total. The competition component is fixed by its rules; ordinary pricing controls change only AI/portal allocations. Legacy paid requests remain outside the competition. The AI fee goes to its configured wallet; the portal component is held by the grading proxy until the current owner burns that NFT to claim. Transfers carry the balance with the NFT, and burning does not restore its lifetime mint allowance. The retained `PaymentPolicy.portalRecipient` storage field must equal the grading proxy. New tools use the four-argument fee setter and do not accept a portal payout wallet.

The contract exposes `activePortal()` with an `accepting` boolean. An expired or burned portal may remain recorded; it cannot admit cards. Callers must check `accepting`, not just `round.portalId`. Windows never overlap. Requesting the next draw during the current window avoids oracle delay at its end; `activateNext()` remains a separate permissionless transaction. With two or more live NFTs the previous portal is excluded; the sole live portal may repeat. Empty pools reject new paid requests. A burned committed result consumes a closed 660-second round rather than changing the selected token or seed. Burning an active portal closes entry but does not advance the round's original end.

## Verification

Use Node 24 and the repository's locked dependencies. Install Foundry separately. Build and test with the explicit `permit` release profile so validation uses the pinned release settings and `out-permit` artifacts. The current engine is close to EIP-170; always run the size check after Solidity changes.

```sh
FOUNDRY_PROFILE=permit forge test --root contracts/boosters
python3 scripts/portals/check-storage.py
python3 scripts/portals/check-release.py
python3 scripts/portals/export-abi.py
pnpm --filter @protopals/yunipals-indexer test:portals
pnpm --filter @protopals/yunipals-indexer typecheck
pnpm --filter @protopals/yunipals-home-web typecheck
pnpm --filter @protopals/yunipals-home-web build
```

Portal storage baselines and supplemental `*.burn-to-claim.storage.json` baselines are included alongside the existing legacy baselines. Checks preserve both prefixes and the original gap ends. Never regenerate a deployed baseline to make an incompatible upgrade pass. `BoosterAdmin` remains stateless. Metadata additions consume three slots of the existing card storage gap without shifting earlier state or changing the provenance getter. The portal changes consume only their own reserved gaps. Live checkpoint state is initialized by new mints in a fresh portal deployment; an older populated deployment requires separate state-aware upgrade preparation.

The local integration test uses real deployed release contracts, Anvil test USDC, a signed browser wallet, the real API and PostgreSQL-compatible durable storage. It mocks AI and the VRF wrapper, makes no public-chain transactions and blocks unrelated browser network access. Supply local paths for `PORTALS_TEST_ANVIL`, `PORTALS_TEST_PLAYWRIGHT` (the `playwright-core` entry point) and `PORTALS_TEST_CHROMIUM`, then run:

```sh
pnpm --filter @protopals/yunipals-indexer test:portals:local
```

Its browser checks cover exact admission/escrow payment, private spell commitment, transfer of a funded portal, owner burn/payout, wallet cancellation, a pending claim surviving reload, a zero-value redemption, reduced supply and survivor rotation, and completion of accepted grading after portal burn and monster transfer. Metadata, paired artwork/grades, history and mobile layout are also checked. Solidity tests additionally cover reserve invariants, short deposits, reentrancy, failed payout rollback, owner/operator restrictions, deadlines, full-kind gas, historical snapshots, one/zero live portals, upgrades and genuine historical Chainlink proofs. Public RPC fork tests remain opt-in.

## Launch inputs and rehearsal

Supply the actual admin and grader wallets, AI payout recipient, airdrop recipients/quantity, approved TCG stack, native USDC contract and direct-funding wrapper for the selected network. Reuse values already supplied in private operator configuration. `PORTALS_FEE_RECIPIENT` is obsolete and ignored; no replacement portal payout address is needed. Keep the grader's key separate from admin/upgrade authority. Configure artifact storage and its public HTTPS API base, including any deployment path prefix. The API never needs the grader's key or the AI key.

The selected airdrop policy is one Rainbow Portal TCG card per live OG Rainbow or Ghost Portal NFT across the OG Ethereum, BNB Chain, Polygon and Base collections. Cross-chain copies count separately. Resolve custody to verified current staking beneficiaries, refresh ownership and finalize the execution snapshot. Build each ordered mint list with one address entry per awarded card; repeated recipient addresses are intentional and must not be deduplicated. Split lists into at most 100 entries per VRF mint commitment and finish each request in chunks of at most 32. Keep recipient evidence and allocation records private.

The generated shared Rainbow TCG card is `apps/yunipals-home-web/public/images/portals/rainbow-portal-card-v2.png`; its source prompt is in `docs/artwork/rainbow-portal-card-v2.prompt.txt`. It uses the same portrait proportions, rounded lavender frame, Yunipals header/logo and bottom nameplate as the existing TCG cards. Publish the exact approved finished-card bytes to a durable HTTPS or IPFS URI before freezing kind 1; the kind image must reference the full card. Onchain metadata identifies Card type as Portal and retains its individual gate traits. Prepare the 264 existing TCG variant image references with SHA-256 hashes; preserve the original shared images. Grading artifacts use SHA-256 byte commitments too. Spell commitments and model policy hashes use keccak256 with their documented ABI/domain or canonical JSON encoding.

The defaults are `gpt-image-2.6-sunburst` for image edits, `text-embedding-3-small` for candidate retrieval, and `gpt-6.1-sol` for separate originality and visual grading passes. Images use medium quality at 1024×1536. A live one-card provider rehearsal passed with these exact models and produced valid structured scores and a cited copying assessment. This does not establish production scoring calibration or a guaranteed per-attempt cost. Before launch, compare recorded provider usage with current account billing and the 0.245 USDC AI allocation, including retry costs. Providers are paid by the operator; accepted user payments do not change with provider costs.

`portals:rehearse` runs an isolated Base Sepolia stack using the release portal and card implementations, the real direct-funding wrapper and a dedicated six-decimal test currency. Read `apps/yunipals-indexer/portals.rehearsal.env.example`, supply dedicated test signing wallets, a separate database, the release artifact directory, all 264 `{ variantId, uri, hash }` PNG references and the approved Rainbow card file. Reuse already-authorized provider/grader configuration by reference on its existing host. The card fixture creates a matching sequence and a mismatching card without changing Rainbow's actual gate probabilities; it does not exercise the live pack-opening service.

```sh
PORTALS_REHEARSAL_ENV_FILE=/private/operator/rehearsal.env pnpm --filter @protopals/yunipals-indexer portals:rehearse
# After reviewing the preflight, --execute broadcasts Base Sepolia transactions only.
PORTALS_REHEARSAL_ENV_FILE=/private/operator/rehearsal.env pnpm --filter @protopals/yunipals-indexer portals:rehearse --execute
PORTALS_REHEARSAL_ENV_FILE=/private/operator/rehearsal.env pnpm --filter @protopals/yunipals-indexer portals:calibrate-originality
```

The runner saves each signed raw transaction before broadcast and reuses it on resume; keep the private state directory and the original artifacts. Run only one instance at a time, using an operator process lock. It verifies chain ID 84532 before every transaction, checks signer identities and artifact hashes, enforces a native spending cap and records actual receipts. Its worker uses the real private intake API, durable job store, independent public ledger and provider. It checks two grading versions, distinctive copying by a new owner, exact test-USDC fees, transfer of a funded portal, redemption, completion after retirement and a real 660-second slot boundary. The private in-process API is not a public preview deployment; publish durable artwork and metadata references separately before production. A compatible RPC must support the worker and ledger's log ranges; an endpoint rejecting a range is not evidence of a missing grading request. The optional `--local` mode requires a loopback RPC and reports its AI/VRF mocks explicitly.

`portals:calibrate-originality` saves seven live cases: exact copying, paraphrase, translation, generic language, same-author reuse, substantial remix and an attempted instruction override. Treat these as a bounded calibration sample and review unexpected results; they do not establish a general false-positive rate. Rehearsal usage records support a list-price estimate, while the operator's billing remains authoritative.

`portals:smoke-ai` performs one paid edit and two assessment calls using `OPENAI_API_KEY`, `PORTALS_SMOKE_INPUT_FILE` and `PORTALS_SMOKE_OUTPUT_DIRECTORY`. It writes the result and usage report privately. Reuse the operator-authorized existing configuration without copying secrets into this repository. Test copying calibration with paraphrases, translations, short generic prompts, substantial reinterpretations, self-reuse and adversarial instructions before activating a rubric. The initial cap is Creativity 20; other scores still evaluate the visual result.

Rehearse the deployment and full flow on Base Sepolia using network-specific USDC/wrapper settings and funded test wallets before approving production transactions. A mock local VRF callback does not establish that a real wrapper is correctly configured. The isolated real-provider Sepolia rehearsal has passed; production deployment remains a separate release step.

## Eleven-entry live AI competition rehearsal

The production pool remains fixed at 111 entries. For a smaller paid-provider
rehearsal, `scripts/portals/build-eleven-rehearsal.py --forge <forge-binary>
--output <private-artifact-directory>` builds an isolated eleven-entry variant.
It leaves release sources unchanged, uses a distinct rules commitment and rejects
other chain IDs in both construction and initialization. Keep its source delta,
artifact checksums and receipts in private operator storage.

`portals:rehearse-eleven` first performs a read-only preflight. Supply the existing
isolated rehearsal environment, `PORTALS_COMPETITION_REHEARSAL_DIRECTORY`,
`PORTALS_ELEVEN_DIRECTORY`, `PORTALS_ELEVEN_INPUT_DIRECTORY` and a Base Sepolia RPC.
Inputs contain matching `artifacts/PortalGradingCompetition.json` and `artifacts/PortalGrading.json`, plus eleven distinct
`{ title, spell }` records in `spells.json`. Credentials are referenced from the
already authorized operator environment; never commit or print them.

With `--execute`, the runner creates fresh proxies using the existing isolated
catalog, test currency and verified implementations. The historical grading
initializer is followed by the tested competition upgrade, preserving compatibility
with the older rehearsal rules helper. Real VRF chooses the portal gates and opens
a strict 660-second slot. Eleven matching test cards upload signed spells and pay
0.99 test USDC each before the actual image-editing and grading worker runs.
All cards share the same gate-compatible source variant; their spells and generated
artwork differ. `--prepare-only` stops after paid admissions without calling AI.

The live run verifies published artwork, metadata, four onchain scores per card,
independent rank calculation, winner-driven public settlement and exact prizes of
2.75 / 1.65 / 1.10 test USDC. It repeats settlement to detect duplicate payouts.
The API, ledger and display read batch size from the contract; release deployments
continue reporting 111. This runner uses bounded 200-block RPC reads.

Run only one process per state directory. Preserve signed transaction checkpoints
and durable AI jobs on retries. `portals:verify-eleven` separately checks canonical
receipts, spell commitments, image/report hashes, admission windows, ranking,
settlement calldata and transfer logs, exact wallet deltas and empty prize reserves.
It also verifies that the earlier 111-entry fixture pool remains untouched.
`portals:review-eleven` exports an offline artwork/slab gallery with spells, scoring
reasons and the verification record. These private in-process API tests do not
establish a publicly hosted metadata service or production readiness.

The completed November 11 live-AI proof uses the archived V1 competition/v3 grader. Preserve its inputs and bundled verifier unchanged. New builds use the sequential-theme V2 rules commitment and current grading implementation; they do not retroactively change that historical proof. The local browser integration covers the transition to a second themed batch.

For a bounded real theme extraction without chain writes, run `portals:smoke-theme` with private `PORTALS_THEME_RESULTS_FILE`, `PORTALS_THEME_PROOF_FILE` and `PORTALS_THEME_OUTPUT_FILE`. It checks all eleven archived rankings and selects the three verified winners. Without `--execute` it only prints preflight; with that flag it uses the authorized `OPENAI_API_KEY` for one extraction. A matching saved output is reused on subsequent runs. Keep its evidence private and do not treat this offchain check as a public-network theme publication.

## Deployment and direct backfill

1. Populate private settings using `apps/yunipals-indexer/portals.env.example`. Verify the chain, current proxy implementations, registry/catalog bindings, wrapper/coordinator/blockhash store, USDC decimals and admin roles. Record real receipts in the private operations repository.
2. Simulate `DeployPortals.s.sol` with `FOUNDRY_PROFILE=permit forge script --root contracts/boosters contracts/boosters/script/DeployPortals.s.sol:DeployPortals --rpc-url "$PORTALS_RPC_URL"`. `run()` creates the stateless helper and four initialized UUPS proxies, including the dedicated competition pool. `deployCardUpgradeImplementations()` prepares the card and engine implementations. Supply the actual sender and add `--broadcast` only for an explicitly approved deployment. Verify sources and bytecode afterward.
3. Pause new pack requests during the card/engine upgrades. Pending callbacks can still arrive: retain their original seed and recover any failed delivery after both upgrades. The engine and card upgrades must be completed together before resuming mints. Do not change frozen pack rules or their entropy derivation.
4. Set the deployed grading address, `PORTALS_COMPETITION_ADDRESS` and launch inputs. `pnpm --filter @protopals/yunipals-indexer portals:prepare` prints reviewable setup/optional upgrade calldata; it never signs or submits. It verifies economics version 2 and a fresh collection with no kinds or claim controller. Calls create Rainbow kind 1, bind the grading proxy once as collection claim controller, configure 0.245/0.245 fees with the grading proxy as escrow, configure the rubric, bind the dedicated competition pool once for its additional 0.50 USDC contribution, and configure artwork/grader/card links. `PORTALS_BASE_ART_JSON` contains all 264 `{ variantId, uri, path }` entries. Local files are hashed during preparation; verify that the published URI serves those exact PNG bytes before registering them. Simulate each call from the actual admin immediately before execution; verify state between dependent calls. A deployer different from the final admin cannot assume these roles.
5. Run `portals:backfill` first without flags to scan canonical completion/mint events and print direct import calls. It verifies the active 264-variant stack, family counts, event order, provenance and actual block timestamps. Then explicitly run with `--execute` using the authorized admin to import write-once facts in batches. Already recorded facts must match canonical values. There is no migration manifest. The start block must include the entire approved engine history.
6. Verify new sequence-aware mints and reconcile all historical cards, including burned cards. Wait for the confirmation horizon to cover any final legacy mints. Close imports with a final `portals:backfill --execute --seal --engine-upgrade-verified` pass. The explicit flag records the operator's verification; it does not inspect deployed bytecode automatically. Closure cannot be reversed through ordinary configuration.
7. Confirm kind 1, artwork, 0.245/0.245 base fee policy and 0.50 competition contribution, escrow destination, claim-controller and competition bindings, economics version 2, zero initial liabilities in both contracts, immutable rubric/model policy, all 264 base artwork records, `GRADER_ROLE` and the card grading link. If the deployment uses token-specific metadata for ungraded cards too, set the card's `setTokenMetadataBaseURI` to the same `/v1/portals/cards/` API base after backfill. Do not enable that endpoint while any required historical facts or artwork are missing.
8. Migrate both private grading and public ledger schemas with `portals:migrate`. `portals:ledger:migrate` can prepare just the public ledger using RPC/database settings. Start `portals:ledger` with `PORTALS_LEDGER_START_BLOCK` set to the earliest verified portal-stack deployment block and the confirmation count. Start the AI worker separately with its verified grading deployment block and restricted grader wallet. Enable the API, verify indexing/metadata/publication, then configure the web app using `apps/yunipals-home-web/portals.env.example`. Its grading address pin protects both USDC approvals and burns; the owner detail route can read and redeem directly while the index is catching up.
9. Use the admin screen to commit the approved Rainbow airdrop in batches of at most 100 addresses. Wait for the same VRF seed and finish each committed batch in chunks of at most 32. No recipient reassignment or reroll is available. Confirm historical/live counts and indexed ownership before the first rotation. Verify the 0.99 USDC admission, 0.245 portal credit, separate 0.50 competition reserve, failed/expired entry without payment, transfer of that balance and an owner burn/payout during the separately approved controlled live acceptance before opening public use. The current local runner supplies full-batch coverage; another paid Sepolia batch is not required.

## Owner claims and public accounting

`burnAndClaim(portalId, minimumAmount, deadline)` is called by the NFT owner on the pinned grading proxy. Claims require no USDC approval and no AI or VRF payment; the wallet pays network gas. The frontend reviews live ownership and full balance, requires an explicit destructive-action acknowledgment, simulates, and submits a single transaction with a ten-minute deadline. Additional accrued funds are included in full. A failed USDC payout reverts the NFT burn and all accounting. Zero-value burns require an explicit zero-payout acknowledgment in the UI.

`PortalFeeAccrued` is the ledger's credit source and `PortalClaimed` is its balance-debit/claimant source. Do not count the retained `PaymentAllocated` event as an additional credit. ERC721 burn transfers remove live ownership without applying a second balance debit. All public ownership/accounting events, projections and cursor advance atomically; a hash mismatch clears and replays the public ledger without touching private grading jobs. Owner/history pagination is bound to a canonical snapshot. The API exposes indexing and chain-read blocks, and balances used for claims always come from live contract reads.

The ledger is a separate long-running process with no OpenAI or signing credentials. Monitor its cursor lag, reserve coverage (`USDC.balanceOf(grading) >= totalPortalLiability`), failed claim transactions and live supply. Direct donations create surplus rather than owner entitlements. Pausing admissions/randomness leaves claims and accepted grading completion available. Once balances exist, do not downgrade to an implementation that lacks escrow accounting or restore a direct-payout UI.

## Worker operation and recovery

Use `PORTALS_PUBLIC_ORIGIN` as the public API base, not merely the hostname when the API sits under a path prefix. Allowlist approved original artwork hosts in `PORTALS_ARTWORK_HOSTS`; include the configured IPFS gateway host when relevant. Files are private, content-addressed, written atomically and synced before submission. Keep the database and artifact directory backed up and retain completed artwork, spells and reports. Do not expose the directory directly through a static server: the API publishes only confirmed completed artifacts.

Each job is bound to its canonical chain, grading contract, request contents, paid price, original submitter, input artwork and immutable model policy. A single pending request per card avoids conflicting source versions. Leases, heartbeat renewal and publication fencing prevent two workers from publishing independent results. Provider and chain failures retry the same job; cached images, assessments and completed submissions are reused. A paid job never expires and has no automatic refund. Missing private spell data can be uploaded again by its original submitter with a valid request-bound wallet signature, including after card ownership changes.

Keep a separately configured worker for every accepted model policy until its jobs are complete. Updating the active rubric changes future requests only. `portals:policy` prints that worker's configured policy, commitment and rubric ID without connecting to RPC, PostgreSQL or OpenAI. With no `PORTALS_MODEL_POLICIES_JSON`, it prints the default policy; otherwise supply exactly one policy, as for the running worker. Run it with each worker's environment and compare the reported commitment to the registered rubric before starting service. `--prepare` checkpoints one result without submitting it; it still uses paid AI calls. `--once` processes one iteration. The regular worker continues ingesting and retrying indefinitely. Dropped/reverted grading transactions retry the cached result; duplicate finalization and changed request bindings are rejected onchain.

The default `yunipals-spells-v4` policy preserves v3's `portalEffects`, a map keyed by decimal portal kind ID with `{ name, instruction }` entries, plus `portalGradingCases` keyed by the same IDs. It adds `competitionThemes` for extraction, Harmony and originality instructions. Kind 1 adds rainbow coloring to the creature itself while keeping its immutable original base color recognizable. The worker reads that color from onchain provenance and retains it in its durable job context. The actual signed spell is not expanded: only image editing and visual grading receive the trusted portal instruction. Reports retain the resolved transformation and effective image prompt. Do not infer base color from a previously edited image or include portal boilerplate in copying comparisons. Historical v1/v2/v3 requests keep their original policy and image behavior.

Keep the retained v1 and Rainbow-effect v2 policies for any requests admitted under their original commitments; their prompt behavior and hashes remain unchanged. Changing per-kind instructions or grading cases requires a new policy/rubric commitment for future admissions, not editing a paid job's policy. Give the API the same `PORTALS_MODEL_POLICIES_JSON` catalog as the configured workers so it can show the effect and grading case whose hash matches the onchain rubric; the default API catalog recognizes v4, v3, v2 and v1. A smoke run with the new policy also needs `PORTALS_SMOKE_BASE_COLOR` set to the actual underlying color and may set `PORTALS_SMOKE_PORTAL_KIND` (default 1).

Every new kind needs an entry in the active policy's `portalGradingCases` before its mint/activation. A case contains `id`, `title`, `summary`, four `criteria`, `principles`, ordered score `bands` covering 1–100 exactly once, and unique `checks`. Each check defines its requirement plus `partial` and `missed` per-category ceilings. The worker rejects a missing case before paid provider calls. The grader returns category reasons and evidence/outcomes for every check; the service applies ceilings, verifies cached results and records `gradingCase`/`gradingAssessment` in the report. The separate copying cap is applied to the resulting Creativity score afterward. Case IDs and policy/rubric commitments must be versioned when these rules change.

The private preview's Grading lab displays the exact candidate policy, per-kind definitions, score anchors and scored examples. Original artwork studies retain their earlier grades and browser notes. Visual controls are labelled and do not claim a fresh originality assessment; unchanged player spells reuse their prior originality findings. Use this review and its feedback export before production rubric activation.

Publication waits for the configured confirmation horizon, including recovery after losing the submission response. A cursor block-hash mismatch hides publications and replays from the grading deployment block; canonical cached results can then be republished without another image edit. Preserve RPC access to historical logs/receipts/block headers. Monitor pending job age, failed retries, missing policies/uploads, signer ETH, database backups and artifact health. Do not discard old jobs or clear progress as a routine retry action.

If VRF delivery fails, recover the original request's proof using the existing blockhash checkpoint/header mechanism. The helper verifies the same Chainlink proof and request ID. There is no admin seed override, cancellation or replacement request. Disabling new randomness/admissions does not cancel accepted grading requests.

## Competition release and recovery

Public resolution is the default flow: a winner or any other wallet calls `settle(batchId)` and pays gas separately. The contract attempts all three fixed payouts. The separate eleven-entry live-AI Base Sepolia run verified winner-driven public settlement and exact balances. The historical 112-entry fixture remains unpaid. Live DON delivery is optional. The current local browser runner verifies sequential theme gating, recovery, 112 fixture entries and all three exact payouts without generating 112 paid images.

The admin binds the pool once using `configureCompetition`. Verify its `grading`, `usdc`, `BATCH_SIZE`, `CONTRIBUTION` and V2 `RULES_HASH` against the actual grading proxy and approved six-decimal USDC. New clients quote `admissionHash()` (rules, chain, pool, batch and theme), passing it as the existing final argument to `admitCompetition`; after binding the old `admit` path is disabled. Legacy pending requests continue under their original binding and price. `admitFor` is an internal self-call entry point and rejects direct external callers.

Record competition membership at successful payment. After the 111th entry, new admissions pause until all grades complete and the next theme is published. `configureRubric` is allowed only between admission batches, and workers retain the previously accepted rubric for earlier pending requests. Per-kind AI/portal price changes still apply to new requests without changing any competition reserve.

Fresh pools seed batch 1 with **Open imagination** and `firstThemedBatch == 1`. Launch preparation grants the dedicated grading wallet `THEME_ROLE`; verify that role along with `GRADER_ROLE`, and activate the v4 rubric and matching API policy catalog. `portals:migrate` also creates the durable `portal_v4_theme_job` table. Operate one current theme policy per deployment while retaining older grading workers for unfinished paid requests. No new provider key or settlement process is required.

For a pre-theme pool upgrade, pause new admissions while preparing the matching grading/pool/API/worker versions. `enableThemes()` is CONFIG_ROLE-only, one-time, and requires `entryCount % BATCH_SIZE == 0`. It preserves existing entries and sets `firstThemedBatch` to the next admission batch. A populated pool then waits for its preceding grades and derived theme; an empty pool seeds the opening brief. Verify legacy storage prefixes/gap endpoints, request bindings, deposits and completion/payout behavior before resuming. Never reset a partially filled batch to manufacture a boundary.

The worker reads confirmed final winners and validates their private spell commitments before extraction. It saves the output and source evidence, then publishes the immutable title/brief and artifact hash onchain. Quotes and cached grading contexts pin that theme. Shared theme material is exempt from plagiarism penalties; distinctive copied spells are still penalized. Interpretation affects Harmony only (partial cap 69, missed cap 39), without automatically adding the brief to image generation. The API exposes the evidence JSON only after confirmed onchain publication.

Monitor missing winning spells, `THEME_ROLE`, publisher gas, theme job leases, publication receipts and artifact availability. Provider outages, reverted transactions and dropped transactions retry the saved output; do not delete progress to reroll a theme. Completion-notification recovery is bounded to keep the regular worker responsive. There is no automatic fallback, expiry or refund. The portal's 660-second clock continues during a challenge pause; reopen only when both the current portal and the themed batch accept cards. Ready prizes remain publicly settleable throughout.

For optional CRE automation, follow [the CRE workflow guide](../ops/portals-competition-cre/README.md) and deploy the receiver with the real network forwarder and actual CRE workflow owner/encoded name. Configure and fund the organization's CRE execution separately from prizes. Verify both the ready-event handler and cron recovery against an actual staged competition, including receiver metadata and an independent check of recipient token balances. The receiver report selects only a batch; changing a report cannot choose another winner or amount.

Monitor `totalLiability`, token reserves, batch funded/completed counts, `pendingCount` and prize-paid events. `USDC.balanceOf(pool) >= totalLiability` must always hold; direct donations do not create entries or enlarge advertised prizes. A ready batch remains in the pending queue until all three transfers succeed. If the optional CRE workflow is enabled later, its one-minute recovery rotates over at most three pending batches so persistent failures cannot monopolize the first queue position.

Anyone can call `settle(batchId)` or retry `payPrize(batchId, rank)`, where rank is zero-based. These functions use the recorded payee and fixed amount. The app's manual competition-number form uses direct chain reads and works during leaderboard outages. Admission pauses and portal/card transfers or burns do not prevent ready competitions from paying. A failed recipient transfer remains owed; it does not reverse the other prizes.

A genuine result-notification failure emits `CompetitionNotificationDeferred(requestId)` without losing the completed card grade. Anyone can call `recordCompleted(requestId)` on the competition pool to copy that exact final onchain result, then settle if the batch becomes ready. The bounded hook reserves sufficient gas to prevent gas estimation from silently starving it. Do not regenerate an image or replace a score to repair competition indexing.

The pool retains upgrade authority and trusts the existing AI grader. Keep contract/governance and grader-key monitoring separate from CRE execution monitoring. Changing the competition contribution, ranking or payout rules requires a reviewed rules/upgrade release; never rewrite funded entries or sweep reserved prizes.

## Resumable public competition rehearsal

This is the historical V1 overlapping-batch fixture. Its runner rejects sequential-theme artifacts before making transactions. Use archived matching inputs and verifier only to resume/audit that existing proof; use the current local integration for the sequential flow.

`portals:rehearse-competition` extends only a previously completed isolated Base Sepolia rehearsal. It checks the chain and dedicated wallet identities, upgrades that rehearsal's grading proxy while proving both legacy request bindings survive, deploys the pool, and prepares four matching test cards. It then runs 112 paid grading attempts across those cards with labelled deterministic scores. No production stack or paid image provider is used.

Supply the existing `PORTALS_REHEARSAL_ENV_FILE`, a separate `PORTALS_COMPETITION_REHEARSAL_DIRECTORY`, and `PORTALS_COMPETITION_ARTIFACT_DIRECTORY` containing the tested minimal `PortalGrading`, `PortalGradingCompetition` and `ERC1967Proxy` artifacts. The RPC must be Base Sepolia. Run without `--execute` for a read-only inspection; `--execute --prepare-only` stops after deployment/card preparation. `--execute --hold-final` completes entry #112 before entry #111 and reserves the final result until the live CRE workflow is watching. A later `--execute` resumes the exact signed transactions and completes #111; `--execute --finish-only` skips the admission loop when only the final result remains. Saved steps retain their original calldata, signer, raw transaction and canonical receipts; do not remove them to bypass an error.

The full run distributes test gas only among the three dedicated submitting wallets and the existing test grader. Exact funding amounts are journaled. Its gross native-spend cap includes those internal transfers as well as transaction fees and VRF funding, so it exceeds net test-gas consumption. A process lock must prevent concurrent runners. The sole surviving portal is opened using real direct-funded VRF; if its strict slot expires, prepare the next committed rotation rather than extending its window. Deterministic test reports and receipt evidence belong in the private operations repository.

For a ready public-network fixture, verify its current state against private receipts before resuming. Public resolution does not require CRE approval. Check exact recipient balance increases and the later batch's unchanged reserve, retaining the pre-payout balance snapshot. Keep public-resolution proof separate from CRE-specific proof; a transaction directly to the pool must not be labelled live DON delivery.

For an optional future CRE rehearsal, CLI authentication and deployment access are separate from the server and test wallets. The existing server can publish the workflow, while Chainlink's DON executes it. Verify the tenant-specific real forwarder and workflow owner/name before receiver deployment. Hold the final grade until publication when testing event delivery; use cron recovery for a batch completed before publication. Independently prove real-forwarder delivery and exact balances. Local simulation or a direct pool call is not evidence of live DON execution.
