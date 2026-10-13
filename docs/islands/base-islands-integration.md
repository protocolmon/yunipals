# Base islands integration

Implemented on 13 October 2026. Browse: https://www.yunipals.com/?collection=islands

## Collections and identity

| Collection | Network | Contract | Supply verified |
| --- | --- | --- | --- |
| `ethereum-islands` | Ethereum (1) | `0xa22e2f53ca787414dc0643c399f92234949e2305` | 898 |
| `base-islands` | Base (8453) | `0x1058f1a6fedcaec94e488d6ec3c639e541faf066` | 898 |

Token identity includes the collection and token ID. Matching IDs are separate NFTs, with separate current owners, transfer histories, query caches and explorer links. The website labels them **Original · Ethereum** and **Airdropped · Base**. The combined browser supports origins, editions, wallet holdings, numeric ID lookup, sorting and stable pagination. Legacy Ethereum staking and unstaking stay on the original NFTs.

Counterparts are verified against the frozen Ethereum snapshot and actual Base mint events, rather than inferred solely from matching token IDs. Snapshot block: `25694139`, hash `0x7d1947e957b1c7ddc734682913b9d31f15ce5a80856a2a4ca163b870aa431109`. Raw snapshot SHA-256: `1c22d608123555d9bdf63d99cf8c77e481d00c195c017e20da55d9f03a02448e`. Distribution SHA-256: `315ecead989a95686a7c41fcdeac9b9ed2e1f586b5e7fae8806a37e8662a0282`. The 898 recipients include staked-beneficiary resolution at that snapshot; the original recipient is displayed separately from the current owner.

## Indexing and RPC

The isolated Base worker scans from deployment block `49650128`. It verifies the chain, exact runtime bytecode and the contract's source/snapshot/distribution/URI constants. It checks all 898 owners at one finalized block and repeats a full ownership audit weekly. A single advisory lock prevents duplicate writers. Events and cursor changes commit atomically. Range boundaries and event block hashes are checked before committing. On a changed canonical checkpoint, the worker checks its finalized anchor, rewinds only Base state and rebuilds ownership from retained events.

Normal polling uses the existing budget gateway at loopback port 19202. The worker polls every 60 seconds, reading recent logs in ten-block ranges. All frontend/API queries read PostgreSQL and make no blockchain calls. Bootstrap history uses bounded 100,000-block ranges; the bootstrap tail overlaps an older range to remain on the budgeted historical route, discarding only events before the durable cursor. Budget/rate errors defer rather than fan out into extra calls.

The user approved a temporary allocation transfer of 10,000 CUs: source 200,000 → 210,000 and order projection 400,000 → 390,000. Both allocations were restored after the backfill. The global 1,000,000-CU cap and 200,000-CU foreground reserve were unchanged. Shared source grants increased by 6,000 CUs during that window; that counter includes other source workers and chunked reservations, so it is not an isolated invoice for this worker.

The original recent-log providers were rate limited. A chain-verified public dRPC endpoint was added to the gateway's free log pool, with existing providers retained as failovers. Paid fallback for source requests remains disabled. Recent polling was observed with zero paid calls after that configuration update.

## Storage and readiness

Base ownership/events/checkpoints live in `yunipals_base_islands_v1`. Frozen origin records live in `metadata.island_airdrop_origin`. Metadata uses the shared publication/source tables, scoped by collection, lifecycle and canonical mint identity. Base's fixed genesis/personal URI behavior is preserved; two HTTP source documents serve the collection, without 898 tokenURI calls. Arena reveal assignments and published proofs are unchanged.

Base readiness requires verified ownership and a completed scan within 15 minutes. Partial progress cannot indefinitely refresh readiness. Ethereum readiness remains independent. The combined API reports unavailable collections and serves available results; pagination cursors include the collection coverage to prevent silently mixing pages across a readiness change.

## APIs

Public prefix: `https://api.yunipals.com/yunipals-indexer`

- `/v2/collections/base-islands/{indexing-status,stats,tokens}`
- `/v2/collections/base-islands/tokens/:id` and `/:id/transfers`
- `/v2/collections/ethereum-islands/...` retains the existing routes.
- `/v2/islands/{indexing-status,stats,tokens}` provides the combined browser.
- Collection and combined `openapi.json` descriptors document the endpoints.

## Deployment and recovery

Backend release: `/opt/yunipals-islands/releases/base-islands-20261013-9f30c43d3441`.

- New worker: `yunipals-base-islands.service`.
- API override: `/etc/systemd/system/yunipals-islands-api.service.d/zzzz-base-islands.conf`.
- Added proxy routes in `/etc/nginx/snippets/yunipals-islands-indexer-location.conf`.
- Free route override: `/etc/systemd/system/yunipals-market-production-rpc@base.service.d/zz-base-islands-free-logs.conf`, referencing a separate public-endpoint configuration file.
- Existing Ethereum ownership, metadata and staking services retain their releases.
- The existing daily Islands backup now includes Base, source schemas/data, provenance and staking positions. Its post-backup step copies a recovery ZIP to Storage Box, checks the remote checksum, downloads it and verifies every archived file.
- The existing one-minute health timer checks both collection services/readiness.

Frontend production: `dpl_HKTbGcrmyDQxLiG9QCj78k2o4Md2` (`yunipals-fhe6yd8rm-devving.vercel.app`), staged and browser-verified before promotion. Previous deployment: `dpl_GFityqV1pukeQN7dpGCN6HGEnR4n` (`yunipals-3znh5xvo9-devving.vercel.app`).

To roll back the frontend, promote the previous deployment. To roll back the API, remove only `zzzz-base-islands.conf`, restore `nginx-before.conf` from `/srv/yunipals-islands/base-integration-v1`, run `nginx -t`, reload systemd, restart the API and reload Nginx. Leave additive database tables intact. The new Base worker can be stopped independently. Free route rollback removes only its new override and endpoint file, then reloads systemd/restarts the Base gateway. Restore the operations files from `operations-before-*` and remove `zz-base-storage.conf` if rolling back backup/health changes.

The pre-change database backup is `/var/backups/yunipals-islands-indexer/2026-10-13T21-19-24-845Z`. Recovery archives contain source, public service/proxy configuration, helper scripts, database dumps and checksums. Protected environment files and credentials are retained separately and are not archived.

## Verification

- 35 focused backend tests passed, including atomic rollback, reorg replay, canonical metadata, independent readiness, same-ID pagination and stale completed scans.
- Backend/frontend TypeScript checks, client tests and the Vercel production build passed.
- Live API pagination verified all 1,796 distinct NFT identities, metadata and counterpart links.
- Chromium verified origin filters, pagination, counterpart navigation, same-ID separation and mobile width against the staged production frontend and live APIs.
- Storage Box upload/download checks passed. A clean temporary PostgreSQL restore verified 898 originals, 898 airdrops, 898 provenance records, 1,796 publications and revisions, two source blobs, zero missing source references and the Base verification checkpoint. The temporary database was removed.

Machine-readable deployment/verification receipts are in `docs/audit/base-islands`. Server controls and rollback copies are under `/srv/yunipals-islands/base-integration-v1`. Credentials are excluded.

### Repeat browser verification

Install Playwright in your normal development tooling, or set `PLAYWRIGHT_MODULE` to its module entrypoint. Set `CHROMIUM_EXECUTABLE` when using an existing Chromium binary. Then run `ISLANDS_BROWSER_URL=https://www.yunipals.com node ops/base-islands/test-browser.mjs`. Protected staged deployments additionally accept `ISLANDS_BROWSER_COOKIE_JAR`, a private authenticated Netscape cookie jar obtained with `vercel curl`; never commit that cookie jar.
