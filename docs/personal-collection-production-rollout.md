# Personal collection production rollout — 22 September 2026

Live at https://www.yunipals.com: token-ID search, rarity ascending/descending, Type/Color/chain filters, and 24-card Previous/Next navigation. Name-prefix search remains disabled: broad prefixes exceeded the one-second SQL budget even after its index was installed. No staging environment or production concurrency stress test was used.

## Deployed artifacts

- Web source: `59ae597aa4ecc6cbf4a98f42f7b5a5ec6e868ccc`, branch `codex/personal-collection-filters`.
- Vercel production: `dpl_69cELXq9Qjy9gU3c7Dd9TF3rNy59`, https://yunipals-92fa8efs0-devving.vercel.app, aliased to https://www.yunipals.com.
- Previous web deployment: `dpl_BKaT3gQg6TZmaTPT5BGeS1beHL2K`, https://yunipals-r6orp95h2-devving.vercel.app.
- Collector service: `yunipals-collector-api.service`, loopback `127.0.0.1:9012`, release `/opt/yunipals-collector/releases/20260922-search` on `yunipals-main`.
- Server bundle SHA-256: `a2ad62e52c8dbb1a58dac9eb235d41bbe3656631710e405a08a83f0b6fef52e2`.
- Nginx snippet: `/etc/nginx/snippets/yunipals-collector-location.conf`. Only collector capabilities and `/v2/owners/` routes use the new process.
- Existing API process was not restarted. Its on-disk source contains unrelated pending metadata work, so this feature was bundled into a separate service from a reviewed source copy.

The service uses four database connections, one-second acquisition and SQL deadlines, JIT disabled for page reads, 16 MB work memory, a 512 MB process memory limit, and no per-token RPC. The UI debounces search, retains at most five token pages, and does not poll tokens every 30 seconds.

## Validation

- Production API: 14 sequential checks against a publicly browsable collection, with one-second pauses. Sorting, forward/reverse cursors, cursor rejection, combined traits, exact IDs, empty matches, hidden reads, and all four chains passed. No wallet transactions or visibility mutations were performed.
- Public large-wallet rarity pages took roughly 0.5–0.65 seconds. Combined traits took about 0.22 seconds; exact-ID and individual smaller-chain checks took about 0.06–0.09 seconds including transport. This exceeds the initial 300 ms aspiration for large-wallet sorts and does not establish concurrency capacity.
- Production Chromium: six flow checks passed, six collection requests, no page errors or failed collection responses. Desktop navigation, filters, search, cache reuse, and the mobile dialog were exercised.
- Local web: typechecks, production build, six collector tests, 140 marketplace tests, four fixture tests, five dependency tests, and nine fixture browser flows passed.
- External indexer: typecheck and 85 tests passed, plus one additional hidden-overfetch regression test. SQL tests traversed 423 pages without missing or duplicate results in a 100,140-token fixture.
- Deployed homepage, collector deep link, and JavaScript hashes matched the locally built production artifacts.
- Existing production health monitor completed at 22:46 UTC: healthy, no failures, no configuration errors, no degraded chains. Both APIs were active with zero automatic restarts.

Individual timing samples and browser checks are recorded in [personal-collection-performance.json](personal-collection-performance.json). They are small read-only smoke checks, not a capacity guarantee.

The valid concurrent `metadata.token_metadata_name_prefix_idx` is installed. An attempted covering index was abandoned after bounded lock waits and was removed; no incomplete collector index remains. No ownership rows or Ponder-managed table definitions were changed.

## Monitoring and rollback

The existing production integrity monitor now reads `/etc/yunipals-marketplace/production/monitor/collector-20260922-59ae597/frontend-manifest.json` through its `99-collector-frontend.conf` drop-in. Its previous manifest remains intact under `disclosures-20260922-ecbff43`.

For a backend feature rollback, set `API_COLLECTOR_FILTERS_ENABLED=false` in `/opt/yunipals-collector/releases/20260922-search/collector.env` and restart only `yunipals-collector-api`. Keep `API_COLLECTOR_NAME_SEARCH_ENABLED=false`. After capabilities refresh or page reload, the UI uses legacy collection browsing. Cached capability responses have a five-minute freshness window.

For a full rollback, restore the recorded previous Vercel deployment, remove only `/etc/systemd/system/yunipals-market-production-health.service.d/99-collector-frontend.conf`, and run `systemctl daemon-reload`. This restores the previous monitor manifest. Remove only the collector include from the API Nginx server block, validate with `nginx -t`, reload Nginx, then disable/stop `yunipals-collector-api`. The pre-rollout Nginx file is backed up under `/opt/yunipals-collector/rollout-20260922/nginx-before.conf`; avoid overwriting any later unrelated changes.

Future metadata archive activation must update the collector's shared metadata-mode configuration and recheck publication/readiness behavior along with the main API.
