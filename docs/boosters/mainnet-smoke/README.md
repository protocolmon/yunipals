# Base mainnet smoke test

**Deployment confirmed, 20 October 2026:** all six contracts are deployed. At block 52848987, their runtime fingerprints, all three EIP-1967 implementation slots, admin roles and dependencies matched the audited package. The wallet nonce is 6, remaining balance is 0.000882801868400175 ETH, and the registry has no configured pack types. See `verification/deployed-state.json`. The exact BaseScan source package is prepared and independently recompiles to the audited bytecode; BaseScan verification is complete: the three implementations are full source matches, and the three proxies have verified OpenZeppelin Similar Match recognition plus the correct implementation links. Published source contents and ABIs were checked against the audit; see `verification/published-source-check.json`. The replacement Etherscan key resolved the authentication issue. Use `python3 scripts/boosters/verify_basescan.py --submit` after configuring the key as described in `verification/README.txt`. Do not regenerate a new deployment plan from nonce 6 or deploy another set.

**Audit re-review, 20 October 2026:** the auditor clears the original findings. The supplied R-01 checkpoint hardening is now applied; see [the implementation response](../audit/checkpoint-hardening-2026-10-20/RESPONSE.txt). This directory's unsigned bundle has been refreshed at block 52846591. All six creation payloads and runtime fingerprints exactly match the final candidate in `../audit/checkpoint-hardening-2026-10-20/`. The rebuilt `/deploy/` page is pinned to package SHA256 `208dffc05cf20c046c356239acc70361912b052a5b4b5ddb1648506848b3b954`; its builder refuses payloads that differ from that reviewed candidate. See `live-2026-10-20/` for publication status and verification evidence. Single-wallet governance remains owner-accepted. The owner selected a limited Base mainnet run. **Actual oracle delivery is not yet tested; wallet signatures are required first.**

Admin and test wallet: **0xB3883Cd96d72B08b8226452305A28D65974a3727**.

The user selected mainnet instead of Sepolia. Before deployment, at block 52846591, the wallet had 0.001 ETH and 10 PROTO, with nonce 0 and no pending transaction. The live VRF preflight passed at block 52846615. These were read-only checks, not evidence of oracle delivery. The user subsequently signed the six deployments, verified above. The 1 PROTO will be burned when the opening request succeeds, even if fulfillment stalls.

`deployment.unsigned.json` contains six ordered contract-creation requests, exact creation bytecode hashes, nonce predictions, observed balances and a native VRF quote. Each proxy initializes its admin and dependencies in its creation transaction. There is no separate, exposed initialization step. These are EOA creation transactions: **omit `to`**, do not send ETH to the predicted address. Do not import as Safe calls or sign the JSON as a message.

The review Site has a browser signing screen at `/deploy/?v=audited-r01-18`. Open it in a browser with the funded wallet's extension, connect the approved account on Base, and confirm one deployment per click. It verifies creation fingerprints, predicted addresses and actual runtime code. It can resume from confirmed chain state after a refresh, and stops if an unrelated outgoing wallet transaction invalidates the nonce sequence. It also checks all four admin roles and registry/monster/wrapper dependencies at completion. Its download includes deployment and audit package fingerprints, receipt hashes, and an explicit `liveVrfTestCompleted: false` flag. The screen deploys contracts only; no type is activated. No private key is collected or stored.

For historical reproduction only (the six deployments are now complete):

```sh
forge build --root contracts/boosters
pnpm --filter @protopals/yunipals-indexer boosters:prepare:mainnet
```

This command is read-only; it has no signer or broadcast path. The current plan starts at nonce 0. Confirm each receipt's successful status and `contractAddress` before the next request. The wallet must not make other outgoing transactions between them. Incoming funding does not invalidate the plan. Gas fields are deliberately absent: the signing wallet should estimate each transaction against the preceding confirmed deployments. A changed nonce requires a fresh plan. The artifact is not a permanent deployment manifest.

If the wallet uses a Ledger, the existing Foundry script can instead create the same contract graph; dry-run before adding `--broadcast`:

```sh
BOOSTER_ADMIN=0xB3883Cd96d72B08b8226452305A28D65974a3727 \
BOOSTER_WRAPPER=0xb0407dbe851f8318bd31404A49e658143C982F23 \
forge script --root contracts/boosters script/DeployBoosters.s.sol:DeployBoosters \
  --rpc-url https://mainnet.base.org --ledger \
  --sender 0xB3883Cd96d72B08b8226452305A28D65974a3727
```

After deployment:

1. Record actual addresses, deployment blocks and receipts. Verify admin/config/pause roles and implementation source on BaseScan. Keep the public frontend's `VITE_BOOSTERS_ENABLED=false`.
2. Publish the artwork API on the existing indexer service with persistent storage. Initialize a **new** `base-mainnet-smoke-v1` artwork catalog with that service's actual HTTPS prefix and publish the eight accepted sample variants. Local demo catalog URLs must never be activated on mainnet. Run the confirmed-reveal queue worker against the isolated booster schema. Generation and visual approval remain manual through Codex; metadata returns a preparation state until an image is approved.
3. Fill `pack.draft.json` with actual engine, artwork commitment and publicly reachable manifest/metadata URLs, then set `status` to `ready`. Preserve supply cap **1**, price **1 PROTO**, interval **86400**, all **264** variants and no boost. `boosters:prepare --manifest PATH` creates configure calldata; after its receipt allocates the type ID, rerun with `--type-id ID` for activation calldata. Mainnet readiness checks reject localhost and unavailable/mismatched manifests. Sign only after inspecting the frozen rules.
4. Point the indexer and a private frontend build at the confirmed deployment. Use the normal `/boosters` wallet flow for exact approval and one opening. It refreshes VRF fees and deadlines. The supply cap limits openings to one; it does **not** restrict the buyer to the admin wallet. Keep the test link private and open it promptly after activation.
5. Observe the live Chainlink callback. Verify one original, a single variant, the PROTO supply decrease, burn destination PMON movement, request-time ETH change, indexed ownership and artwork state. Generate the revealed variant on demand if absent; approve and publish it once. Confirm its image and holo masks in the detail viewer.
6. Pause sales with `pauseSales(typeId,true)`. After 24 hours from reveal, claim an accrued mint with a fresh VRF quote and verify duplicate-free progress. After seven more credits accrue, exercise a q=7 batch (day 8 if one credit was used on day 1). Test transfer/burn semantics using the local suite first; burning the real original permanently forfeits pending and future rights.
7. Validate original-proof recovery using a genuinely lost outer callback on a separate disposable test deployment under the live wrapper's key. An inner mint failure preserves the seed and only tests ordinary `recover`; it does not test `restoreRandomness`. Keep deliberate fault injection isolated from real collection holders. Record all transaction hashes as evidence.

The pinned mainnet fork test passed at block 52822651 against the actual PROTO and Chainlink wrapper. It proves the burn and request behavior in local fork memory. It manually supplies a callback and does not establish real oracle delivery. The live callback and following day's claim remain pending until the funded wallet signs.

To update the browser signing package after regenerating the plan:

```sh
node scripts/boosters/build_deployment_page.mjs
```

The bundle includes no external JavaScript dependencies and pins the exact JSON package by SHA256. Publish the rebuilt Site source through the Sites workflow. Its browser tests route every Base RPC call to a loopback Anvil fork, so their simulated wallet confirmations cannot spend mainnet funds.
