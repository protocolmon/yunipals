# Daily crews and expiring packs

This supersedes the solo-adventure entry rules in [the original progression plan](adventures-serums-fusion-plan.md). It does not change already accepted requests or the mint rights of activated pack types.

## Player rules

Each UTC date has one shared VRF draw: a color and species. A crew contains three distinct, owned, ungraded monsters in order: color match, Diamond horn, species match. Each role can match an actual ancestor of a fused card. At least one member must be an actual base monster minted on that UTC date; fusing or transferring a monster does not give it a new birth date.

The player chooses the survivor before signing. All three cards become reserved and nontransferable. Once randomness arrives, the other two burn and the survivor receives a guaranteed serum, atomically. The survivor keeps its NFT identity, applied doses, birth and provenance. Its old unused serum is replaced; unused serums on sacrifices disappear. Sacrificing an original ends its remaining daily rights. Pending daily claims prevent that original from departing, and a locked original cannot start another claim.

The serum rarity table is the existing survivor-sequence tier conditioned on finding a serum: remove the no-find weight and renormalize the other weights. Presence stays Holy 1%, each other Presence 9.9%. Every participant receives the existing rolling 24-hour cooldown. No artificial trip timer is added. If settlement fails, the saved entropy can be retried without another draw or sacrifice.

Daily requirements change at 00:00 UTC. A permissionless paid VRF request can prepare today or tomorrow. The UI fetches a capped randomness quote from the API when the player reviews a shared draw, before wallet confirmation. It does not poll the browser RPC for fees. Operators can prepare tomorrow in advance; after downtime anyone can prepare the current day. Accepted departures keep their committed day and result even if settlement occurs later.

## Pack rights

Existing activated pack types permanently retain banked claims, including future originals purchased from those types. The expiry flag defaults to false and cannot change after activation. To sell expiring packs, activate a **new type** with `dailyClaimsExpire: true` and pause sales of the old type when switching the storefront. Pausing sales does not stop existing originals from claiming.

An expiring original has 263 claim windows for a 264-variant catalog. Window 1 is `[reveal + 24h, reveal + 48h)` and window 263 is `[reveal + 263d, reveal + 264d)`. Each allows exactly one accepted claim. Missed windows are lost, transfers do not reset them, and the schedule ends at `reveal + 264d`. A claim accepted before expiry remains valid when VRF arrives later. A long pending request can occupy a later window; there is no catch-up after expiry.

The first original has sequence 0. New daily offspring use their committed window number, so missed windows leave sequence gaps and cannot later create adjacent fusion pairs. Variant draws still exclude already minted variants; missed claims are not preassigned to particular variants. Claim every window to mint the full set. Burning or sacrificing cards never returns their variants to the draw pool.

Expiry requires a one-day interval and one mint per interval. It has a distinct frozen rule hash. New types may reuse the approved TCG catalog and artwork: progression and portal eligibility compare the activated catalog, artwork hash and metadata base URI, not the original type ID alone.

## Local verification and release

The checkout includes contract tests, API/quote validation tests, shared accounting tests, projection tests and a real browser crew-picker test with fixture wallet/API data. Browser verification does not submit a live transaction. Run:

```sh
forge test --root contracts/boosters
python3 scripts/boosters/check-storage.py
python3 scripts/evolution/check-crew-release.py
pnpm --filter @protopals/yunipals-indexer test:evolution
pnpm --filter @protopals/yunipals-home-web test:evolution
pnpm --filter @protopals/yunipals-home-web test:boosters:daily-all
pnpm --filter @protopals/yunipals-home-web test:evolution:crew-ui
```

The browser script accepts `--playwright` and `--chromium` paths if the dependencies are installed outside the app. ABI exports come from the default optimizer-runs-1, via-IR build. Historical source ABIs remain pinned; a new adventure ingestion ABI includes daily draws and crew commitments. Compact custom errors keep the implementation runtimes within EIP-170.

For an existing deployment, `evolution:prepare-crew` outputs unsigned upgrade calls. Supply the operator's actual proxy and implementation addresses privately; the script never signs or sends. Upgrade the pack registry first, then cards, engine, grading, and adventures. The grading implementation must deploy with its updated validator. Verify storage continuity, deployed runtime size, dependency bindings and pending-request recovery in a fork before execution. Do not use the original `evolution:prepare` binding call to rebind an existing deployment.

Deploy a new shared indexer release with the new registry/adventure event ABIs and `booster_type.daily_claims_expire` column. Replay activation history (old events default to false), then verify canonical readiness before switching readers. Daily requirement requests use the adventure projection so the existing worker retries saved randomness if a callback defers. Upgrade the API and frontend together: purchase review reads the policy from the indexer's pack-type response, matched to the configured deployment and frozen rules hash. Missing policy data blocks purchase review instead of assuming banked claims or falling back to browser RPC. Crew quotes include all ordered input IDs, the selected survivor, the UTC date and rules hash. Quotes expire before the next UTC day. Live transaction simulation, wallet checks and submission remain part of transaction preflight.

Enable crew mode once indexer/worker readiness is verified. This one-way switch rejects new solo departures; already accepted solo requests settle with their original odds. Leave existing collections and their rights intact. Prepare the next day's requirements, activate the new pack type with the expiry flag, and pause old-type sales at the intended cutover. `boosters:prepare` emits the draft policy call before activation; execute all prepared calls in order.

No production upgrade, activation, sale pause or deployment is performed by these source changes.
