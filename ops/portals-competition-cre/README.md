# Grading competition settlement workflow

This is an optional automation integration. The default product flow is permissionless settlement from the app: any winner or other caller can invoke `settle(batchId)` after all 111 grades are recorded. The contract determines all three payees and amounts, and the caller pays gas separately. Neither CRE deployment access nor a server settlement worker is required to launch that flow. Portal rotation continues to use the separate existing Chainlink VRF integration.

This workflow watches `CompetitionReady` at finalized confidence and submits a CRE report to `PortalCompetitionReceiver`. It reads the batch's stored top three; the report carries only the chain ID, pool, rules hash and batch number. The pool independently enforces all winners and amounts. A one-minute cron handler retries up to three outstanding batches, rotating across the pending queue so an unpaid batch does not prevent later batches being processed. Each handler reads one finalized block consistently.

The prize contract can also be settled directly by anyone. Neither an indexer outage nor an unfunded or paused workflow changes the prize rules. The app includes a direct competition-number settlement form. Transaction costs and CRE billing are funded separately; every entry's 0.50 USDC remains reserved for prizes.

## Local validation

Install Node 24, Bun, and the official CRE CLI. Dependencies are pinned in `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run typecheck
bun test planner.test.ts
bun node_modules/@chainlink/cre-sdk/bin/cre-compile.ts main.ts dist/workflow.wasm
```

The official compiler type-checks the workflow, checks deterministic/runtime-compatible code, and produces WASM using its Javy plugin. Local compilation is independent of deployment access. Unit tests cover report domains and recovery rotation; Solidity tests cover the receiver's forwarder/workflow identity, domain checks and replay behavior. The application integration runner exercises 112 entries and permissionless browser settlement using a local chain and deterministic grades.

## Configuration and release

1. Create or use a private CRE project with `cre init`; place this workflow directory inside that project. Configure the project's RPC targets using `project.example.yaml`. Keep operator endpoints, credentials and receipts in private configuration.
2. Deploy the competition proxy with the actual grading proxy, six-decimal USDC and final admin. The grading admin's unsigned setup calls bind the competition once. Existing paid grading requests remain outside the competition; new requests explicitly quote its rules and contribution.
3. Copy `config.example.json` to `config.staging.local.json` or `config.production.local.json`. Replace the deliberately unusable zero addresses with the verified pool and receiver. Set `rulesHash` to the deployed pool's `RULES_HASH()`. Production uses chain ID 8453, selector name `ethereum-mainnet-base-1`, and `isTestnet: false`; staging uses Base Sepolia 84532. The workflow rejects inconsistent network settings.
4. Authenticate the CLI under the intended organization and verify DON deployment access with `cre whoami`. Login and deployment entitlement are separate; `cre account access` requests approval if needed. A test workflow can use `deployment-registry: private`, managed by the existing login without linking a wallet on Ethereum Mainnet. Its workflow owner is derived from the authenticated organization, rather than the test deployer wallet. Obtain the actual public owner before deploying the receiver. Configure execution billing and receiver gas limits independently of the prize pool and existing VRF funding. The workflow uses no OpenAI key or grader signing key.
5. Deploy `PortalCompetitionReceiver` with the verified tenant/network Chainlink forwarder, the workflow's owner and its actual CRE-encoded bytes10 name. The name is the first ten lowercase hexadecimal characters of SHA256 of the UTF-8 workflow name, encoded as ten ASCII bytes. Use the documented encoding, not an arbitrary cast of the human-readable name or ten raw digest bytes. The receiver checks owner and name together. Simulation and production forwarders differ; never use a mock forwarder for a live workflow.
6. Simulate both triggers under the staging target. The log handler is trigger index 0 and needs a real ready-event transaction; the recovery handler is trigger index 1. First run without broadcasting, then rehearse delivery to the staging receiver with explicitly funded test accounts. An empty recovery queue alone does not verify onchain delivery.
7. Deploy under the intended target, verify workflow owner/name against receiver getters, and observe an actual ready batch settling. Verify independent winner balances, zero liabilities for the settled batch, and an unaffected later batch. Keep receipts private. Do not interpret local WASM compilation or fixture tests as a live DON rehearsal.

`DeployPortals.deployCompetitionReceiver()` prepares the receiver deployment from the `PORTALS_COMPETITION_ADDRESS`, `PORTALS_CRE_FORWARDER`, `PORTALS_CRE_WORKFLOW_OWNER` and `PORTALS_CRE_WORKFLOW_NAME` settings. The normal deployment script simulates unless explicitly broadcast. The pool and grading contracts retain UUPS upgrade authority, and scores still come from the authorized AI grader; these are explicit trust dependencies.
