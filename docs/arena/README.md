# Yunipals Arena

Four owned Yunipal NFTs enter a tournament on Base. Each pays 2 USDC; the champion
receives 6 USDC, the island host 0.40 USDC and operations 1.60 USDC. The roster
plays two semifinals and a final, followed by one 24-second battle film.

The live deployment is recorded in [public-deployment.json](public-deployment.json).
This repository publishes the contracts, indexing, server, website, referee rules,
video prompt compiler, tests and deployment templates. Operator credentials,
private player submissions, databases, backup inventories and internal launch
records are excluded. Historical generated films and experiment folders are not
required to build the application.

## How a tournament works

1. The first paid entry requests Chainlink VRF. All 898 published Base islands
   participate; each Genesis island has three tickets and each Personal one has
   one (1,948 tickets total).
2. Four seats and the selected island open a 24-hour strategy window. Owners
   submit custom signed strategies to the central server. Strategies remain
   private until the complete input is ready.
3. A missed strategy gets a deterministic random legal attack and retains its
   entry fee in the pool. The original submitted strategies stay unchanged.
4. One centralized LLM referee resolves the bracket. Deterministic validation
   checks the result before settlement. The accepted result is fixed before video
   production; VRF proves the island selection, not the referee's judgment.
5. Runware produces three opening images and six Grok video clips at 720p. The
   first successful assets are used, with no automatic quality rerolls. The
   website exposes judging evidence and saved generation prompts after reveal.
6. All payouts become claimable after the completed film is published and its
   hash is confirmed onchain. The frontend waits for the indexed transaction
   effect before declaring completion.

An unfilled tournament expires after seven days. An unsettled result expires
24 hours after input freeze; full refunds apply. There is no early withdrawal.
The entering wallet retains its entry and prize if the NFT is transferred. The
island beneficiary is fixed when its selection is finalized. Onchain settlements
can reveal winners before video playback; the server operator can read unrevealed
strategies. Failed video production retains the accepted result and requires
technical recovery before payout release.

## Source map

- `contracts/arena`: Foundry contracts, tests and pinned dependency installer.
- `apps/yunipals-market-api/src/arena/live`: production API and supervised workers.
- `apps/yunipals-market-api/src/arena`: local laboratory, catalog and shared logic.
- `apps/yunipals-home-web/src/pages/arena`: live website and local lab.
- `packages/yunipals-market-core/src/arena*.ts`: shared ABI, rules and UI types.
- `scripts/arena`: deterministic validation, prompt compilation and film assembly.
- `rules-v2`: exact combat rules, referee instructions and output schema.
- `identity-registry-v1`: four reviewed public artwork profiles and references.
- `ops/arena`: deployment templates, encrypted backups and recovery tooling.

Do not reformat `scripts/arena/referee.py` or change frozen rules/identity data
without a rules-version plan: their hashes are bound into the live rules hash.

## Development

Use Node 24.18.1, pnpm 9.12.0 and Python 3.12+. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @protopals/yunipals-market-api typecheck
python3 -m pip install jsonschema
python3 scripts/arena/test_referee.py
pnpm --filter @protopals/yunipals-market-api test:arena:input
pnpm --filter @protopals/yunipals-market-api test:arena
```

The laboratory uses test randomness and is separate from paid Base tournaments:

```sh
ARENA_LAB=1 pnpm --filter @protopals/yunipals-market-api dev:arena
```

For the optional `/arena-lab` browser UI, run the web dev server and configure a
local reverse proxy for `/api/arena` to `http://127.0.0.1:53901`. The standalone
lab API and tests work without a browser proxy. Provider operations require explicit flags and local
credentials; the ordinary lab tests do not generate paid media. The historical
operator lab pipeline additionally uses a locally installed `codex` CLI.

For the production integration tests, provision a **dedicated disposable**
PostgreSQL database, set `ARENA_TEST_DATABASE_URL` and run:

```sh
cd apps/yunipals-market-api
node --import tsx --test --test-concurrency=1 src/arena/live/live.test.ts src/arena/live/ongoing.test.ts src/arena/live/storage.test.ts src/arena/live/recovery.test.ts
```

Never point tests at a production database. Contract setup and tests are described
in [the Foundry README](../../contracts/arena/README.md).

## Public island assets

The exact 898 assignments, 898 metadata records and ten combat profiles are
included as ordinary files at the paths used by the deployed catalog. Their
published hashes and VRF seed are public reveal data, not wallet secrets.
Island PNGs (~1.85 GB) stay on the public asset server. Download only needed images
for local media work, or the entire set for the offline server release inspector:

```sh
python3 scripts/arena/fetch_island_art.py --token-id 1122 --download
python3 scripts/arena/fetch_island_art.py --token-id 1122
# Complete production image cache:
python3 scripts/arena/fetch_island_art.py --download
```

Downloads are bounded and verified against the committed SHA-256 checksums.
The code build and catalog/contract tests need no island-image downloads.
The included soundtrack is **Split In Synapse** by Kevin MacLeod, documented as
CC BY 4.0 in its [credits](../islands/race-film-v4/audio/CREDITS.txt). Preserve those
credits with films. The repository MIT license covers source code; separate media
credits and third-party dependency licenses remain applicable.

## Production

See [the operations guide](../../ops/arena/README.md). The existing live contract
must not be redeployed just to update application code. Source publication does
not perform any deployment, paid generation or chain transaction.
