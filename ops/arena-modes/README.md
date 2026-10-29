# Shared Arena deployment and cutover

Deploy one `YunipalsArenaV2` through `/arena/setup`. The frozen public package is
`apps/yunipals-home-web/public/arena/shared-arena-deployment-v2.json`, SHA256
`3234c6116adecd55b5db04c754c12cd0c72c0406bbeec092e07dcb9fe61053bd`.
The browser verifies the confirmed creation, runtime, roles and initially paused
modes before producing its deployment record. Reuse registry
`0xdbcab53a8e32d43997de252fd49c43ab8df290bf`; keep its four fighter approvals and
applications open as requested. No reserve deposit is required.

The following actions require the confirmed address and block. They must not be
performed using predicted addresses or invented source readiness:

1. Verify SSH hostname `yunipals-main` at `root@168.119.172.10`. Preserve the old
   video contract's 2 USDC liability, claims, canonical source and private jobs.
   The old video owner differs from the new admin; disabling old admissions is
   separate from an onchain pause by that owner. Do not sweep any claim funds.
2. Stage a native Ponder candidate retaining every existing source and start
   block. Add only `UNIFIED_SHARED_ARENA` and
   `UNIFIED_SHARED_ARENA_START_BLOCK` for the confirmed new deployment. Register
   its actual manifest/build, catch up canonical coverage and review the binding.
   Keep the existing global source and other consumers running.
3. Build the API and package the frozen anime engine, recipes, backgrounds,
   rules, island profiles and media dependencies together. Install the immutable
   release at `/srv/yunipals-arena-modes/releases/RELEASE` and retain its exact
   archive for encrypted backup/restore. Review all archive paths and hashes.
4. Create separate operational rows `8453:ADDRESS:video` and `:anime`, initially
   halted, and review their immutable source epochs with `arena-source-switch`.
   Use distinct least-privilege database login identities per mode and worker,
   cloned from corresponding reviewed roles, and separate read-only source
   credentials. Review role connection limits and total pool capacity before
   adding services. No owner key belongs in a worker.
5. Prepare `/etc/yunipals-arena-modes/{video,anime}/runtime.env` and `roles/*.env`.
   Required differences from existing mode configuration: `ARENA_CONTRACT_VERSION=2`,
   common confirmed contract and block, each package rules hash,
   `ARENA_MEDIA_KIND`, `ARENA_INDEXER_MODE=unified`, source kind/release, public
   origin, unique API ports 53915/53916 and media directories
   `/var/lib/yunipals-arena-modes/MODE/media`. Anime alone sets the registry.
   Keep `ARENA_ENTRIES_ENABLED=false`, `ARENA_NEW_LOBBIES_ENABLED=false` and the
   existing pilot wallet allowlist until readiness review. Provider keys remain
   in their existing protected files; do not print or copy them into artifacts.
6. Run `python3 ops/arena-modes/render_units.py --output /tmp/NEW_REVIEW_DIR`.
   Review/install those exact units, whose systemd credential names are explicitly
   allowlisted. API gets admission signing only; lobby gets operator signing;
   settlement gets referee signing. Referee alone receives OpenAI, video media
   and capacity receive Runware, anime media and capacity receive OpenRouter.
   Provider env files precede mode settings to avoid overriding the deployment.
7. Add `/api/arena-v2/video/` and `/api/arena-v2/anime/` proxy locations, preserving
   old API routes. Prove health, both mode configs, assets, source binding,
   admission filtering, nonces and refund receipt tracking. Extend encrypted
   backup and restore coverage to the new configuration, release and private media.
8. Disable old admissions and lobby creation, retaining old claims/settlement and
   transaction tracking. Expire any old short-lived permits before declaring
   cutover complete; obtain the old owner's pause signature when available.
   Set `VITE_SHARED_ARENA_API_URL=https://api.yunipals.com/api/arena-v2` only when
   both new mode APIs are ready. Historical video routes and claims remain on
   the old API. No old anime battles exist to migrate.
9. Enable only reviewed pilot services/settings, then request browser-signed
   per-mode unpauses from the new admin. Run the four-entry anime pilot: first
   entrant's approved ETH quote, one oracle request, subsequent zero draw fees,
   strategies/loadouts, real production API tasks, film, settlement and claims.
   Record exact provider receipts/costs and ETH actually spent, excluding
   refundable buffer and network gas. Unique artwork for 898 islands remains
   deferred; the single reviewed background stays in use for this acceptance.
