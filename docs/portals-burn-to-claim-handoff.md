# Portal burn to claim handoff

Historical handoff, 8 November 2026. For current engineering and activation prerequisites, use [implementation status](portals-implementation-status.md) and the private operator deployment record. The following describes the original fork at that date: the change was implemented in the shared working tree, including the frontend owner claim flow. No public-chain deployment, production upgrade, airdrop, server configuration or service activation was performed in that fork. The changes were uncommitted alongside substantial pre-existing work.

## Behavior now implemented

Rainbow admission remains 0.49 USDC. The AI wallet receives 0.245 immediately; 0.245 is backed by USDC in the grading proxy and credited to the exact portal used. The balance follows ownership. Only the current owner can call `burnAndClaim(portalId, minimumAmount, deadline)` to atomically destroy the portal and receive its full accumulated amount. Approved operators and admin cannot independently redeem another owner's NFT. A failed payout restores the NFT, indexes, balance and liability.

Owner redemption works outside active windows, while grading is pending, and while admissions/randomness are paused. Zero-value burns are supported with explicit UI confirmation. Retired IDs and lifetime mint allowance are never reused. Accepted grading jobs still finish after the portal burn and monster ownership changes.

An active burn closes entry immediately while retaining the round's scheduled end. Pending VRF draws keep their original token mapping through immutable pool snapshots. A selected portal burned before settlement consumes a closed 660-second round; it is not replaced with another token or seed. New requests exclude burned tokens. The last live portal may repeat; an empty pool rejects new paid randomness requests. Utility selection exposes the selected ID and its current availability separately.

## Where to continue

- [Implementation specification](portals-burn-to-claim-plan.md), [overall status](portals-implementation-status.md) and [release runbook](portals-runbook.md).
- The updated system graphic, exact generation prompt and source/hash record are retained in the private review archive. It used the prior diagram plus the actual Rainbow Portal and Blue Yunidragon card references.
- Reuse the supplied admin/grader/AI-payout settings from private operator configuration. `PORTALS_FEE_RECIPIENT` is obsolete and ignored. Read untracked `AGENTS.local.md` before any production check or change; recipient reports and operator-specific evidence remain private.

## Code map

| Area                                                            | Files                                                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escrow, credit and redemption                                   | `contracts/boosters/src/PortalGrading.sol`                                                                                                                                                        |
| Controller binding, live membership and historical portal reads | `contracts/boosters/src/PortalCollection.sol`                                                                                                                                                     |
| Packed pool history                                             | New `contracts/boosters/src/PortalPool.sol`                                                                                                                                                       |
| Immutable selection snapshots and unavailable rounds            | `contracts/boosters/src/PortalRegistry.sol`                                                                                                                                                       |
| Kind validation and economic metadata description               | `contracts/boosters/src/PortalRules.sol`                                                                                                                                                          |
| Setup/deployment and storage checks                             | `contracts/boosters/script/DeployPortals.s.sol`, `scripts/portals/check-storage.py`, new `config/*.burn-to-claim.storage.json`, indexer `lib/portals/prepare.ts` and `scripts/prepare-portals.ts` |
| Generated ABI and economic version                              | `packages/yunipals-market-core/src/portalAbi.ts`, `portals.ts`                                                                                                                                    |
| Public event index                                              | New indexer `lib/portals/ledger.ts`, `ledger-store.ts`, `scripts/portal-ledger.ts`                                                                                                                |
| Live reads and owner/history API                                | Indexer `lib/portals/chain.ts`, new `owner-routes.ts`, existing `routes.ts` and `runtime.ts`                                                                                                      |
| Owner wallet transaction flow                                   | New frontend `src/lib/portalClaims.ts` and `src/hooks/usePortalClaim.ts`; shared validation is also used by `usePortals.ts`                                                                       |
| Owner pages and confirmations                                   | New `PortalOwnerPage.tsx`, `PortalTokenPage.tsx`, `PortalClaimDialog.tsx`, `PortalActivityList.tsx`                                                                                               |
| Existing page integration                                       | Frontend `src/lib/portals.ts`, `PortalPage.tsx`, `PortalAdminPage.tsx`, route registration and a small collector-page link                                                                        |
| New validation                                                  | `contracts/boosters/test/Portals.t.sol`, indexer `test/portal-ledger.test.ts`, revised API/setup tests and real local/browser integration scripts                                                 |

The collection originally exceeded EIP-170 when the generic checkpoint implementation was inlined. `PortalPool` now uses a focused packed `uint48`/`uint208` history with binary lookup, and kind text/URI validation uses the existing stateless helper. No new deployment library is required. Supplemental baselines protect the added state while retaining the original storage baselines and gap ends.

## Frontend and API

`/portals/mine` lists owned portals, accumulated USDC and claim history. `/portals/tokens/:portalId` reads the portal directly from the pinned contracts, so an owner can redeem while discovery indexing is delayed or unavailable. The confirmation names the portal, full payout, recipient and permanent burn; it requires acknowledgment, simulates, and submits one transaction with no token/NFT approval or VRF fee. Pending transactions survive reload, replacements/cancellations are reconciled, receipt events determine success, and the app refreshes balances, ownership, supply and history. A post-receipt block-hash change triggers rechecking.

The new owner routes are under `/v1/portals/owners/:address` and `/v1/portals/tokens/:portalId`; these are distinct from monster `/cards/:tokenId` grading routes. Holdings use confirmed transfer discovery and pinned live monetary reads. Activity and claim pagination carry a canonical snapshot/generation; reorgs invalidate stale pages. The root status handles retired portals without calling their live-only gate getter.

## Start the public ledger at release

`portals:migrate` now creates both grading and public ledger schemas. `portals:ledger:migrate` can create only the ledger tables without AI/artifact configuration. Run the new long-lived `portals:ledger` process separately from the AI worker. It requires RPC/database settings and `PORTALS_LEDGER_START_BLOCK`, the earliest verified portal-stack deployment block, plus `PORTALS_CONFIRMATIONS`. It requires no OpenAI or signing key. `--once` performs one bounded indexing pass.

The ledger persists canonical raw events, ownership/balance projections and its cursor atomically on a dedicated PostgreSQL connection, with a per-deployment advisory lock. Credit request IDs are unique. A reorg resets/replays only the public ledger, leaving private jobs and generated results intact. Confirmed discovery may lag live ownership; the detail route remains directly usable.

Fresh setup requires economics version 2, no portal kinds, and an unbound collection. Prepared calls create Rainbow, bind claim authority once to the grading proxy, set the four-argument fee policy, and configure artwork, rubric, grader and card linkage. Review/simulate these calls as the final admin. The retained five-argument policy setter accepts only the grading proxy as the portal destination. An older populated portal deployment needs a separate state-aware migration; it must not be treated as fresh merely because storage prefixes match.

## Validation completed

- Release Solidity suite: **140 passed, 0 failed, 8 opt-in network tests skipped**. Includes a 1,000-token kind, historical position reuse, funded/retired state across upgrades, zero fees/claims, failed payout rollback, short-deposit rollback, reentrant payout rejection, multiple portal liabilities, pending/active burns and one/zero live portals.
- Storage prefix checks, supplemental state baselines and fixed gap-end checks passed for all six release contracts.
- Runtime sizes: `BoosterPacks` 24,569; `YunipalMonsters` 17,595; `PortalRules` 10,113; `PortalCollection` 23,256; `PortalRegistry` 13,538; `PortalGrading` 23,717 bytes. Use the `permit` profile and keep rerunning size checks after changes; the old mint engine has only seven bytes of headroom.
- Backend portal/API/provider/backfill/ledger suite: **30 passed**. Covers canonical replay, exact projections, duplicate credit rejection, atomic rollback, historical ownership pagination, stale/cross-wallet cursors, disabled routes and reorg handling.
- Real local contracts/API/PGlite/browser test passed. It pays through the portal, transfers the funded NFT, rejects a wallet request, restores a pending claim after reload, burns/pays the new owner, confirms retirement/supply/history, completes the existing grading job after the portal burn and card transfer, rotates survivors and performs a second zero-value claim. It checks actual USDC balances and that claims add no approval transaction. AI and VRF are mocked locally.
- Frontend/indexer type checks and production frontend build passed. The existing large-chunk build warning remains. Desktop/mobile screenshots were inspected and the browser reported no page errors.

Reproduce with Node 24, the locked dependencies and configured local Foundry/browser executables:

```sh
FOUNDRY_PROFILE=permit forge test --root contracts/boosters
python3 scripts/portals/check-storage.py
python3 scripts/portals/check-release.py
python3 scripts/portals/export-abi.py
pnpm --filter @protopals/yunipals-indexer test:portals
pnpm --filter @protopals/yunipals-indexer typecheck
pnpm --filter @protopals/yunipals-home-web typecheck
pnpm --filter @protopals/yunipals-home-web build
pnpm --filter @protopals/yunipals-indexer test:portals:local
```

## Remaining release work

The original session should finish the airdrop allocation decision using the private OG-holder report, refresh/revalidate the chosen recipient snapshot near execution, publish final artwork/rubric references, rehearse with the real direct-funded wrapper on Base Sepolia, and review provider billing/scoring calibration. Then prepare the production deployment, card/engine upgrades and direct backfill, admin claim binding/setup, public ledger/API/worker service configuration and feature activation according to the runbook.

No recipient allocation, public-chain deployment or broadcast was implicitly performed by this implementation. Preserve the previous user decisions and supplied configuration when continuing.
