# Personal collection rarity-range rollout — 23 September 2026

The personal collection now supports inclusive minimum and maximum rarity-score filters. The score matches the collection cards and sort order: capped rarity with raw rarity as a fallback. Tokens without either score are excluded when a bound is active. The filter URL and cursor identity include both bounds.

The filter dialog now keeps Chain and Rarity controls visible above persistent Type and Color tabs. Only the active trait pane scrolls; each tab restores its own scroll position. Arrow keys switch tabs, invalid or inverted ranges disable Apply, and Apply still sends one collection request.

## Production artifacts

- Source commit: `f72d542` on `codex/personal-collection-rarity-range`.
- Verified prebuilt web deployment: `dpl_Wxc4BEw51owY7CQSMw5RaGCax8Wh`, `https://yunipals-6rrsp16al-devving.vercel.app`, promoted to `https://www.yunipals.com`.
- Collector release: `/opt/yunipals-collector/releases/20260923-rarity-range` on `yunipals-main`.
- Collector bundle SHA-256: `477be4db23ba7116bffd8501f98ea348d60e99d0860af54516710b9514f9323c`.
- Feature flag: `API_COLLECTOR_RARITY_RANGE_ENABLED=true`. Name-prefix search remains disabled.

The backend was started privately on loopback port 9013 with the range capability disabled, smoke-tested, enabled only on that candidate, then tested and measured again. The existing collector route stayed live during those checks. Cutover changed only `yunipals-collector-api`; the legacy API process was not restarted and Nginx routing did not change.

## Performance and verification

The isolated 100,140-row SQL fixture completed wide and narrow rarity ranges at 66.76 ms and 55.05 ms p95. A 60-second production-data run made 13 sequential requests with no errors and 620.81 ms p95/p99. That remains above the original 300 ms aspiration but matches the existing 0.5–0.65 second large-wallet baseline and stays inside the one-second SQL deadline.

On the public route, an exact rarity range took 380.4 ms of server time. Ordinary large-wallet pages in the same run took 455.7–504.1 ms. Combined traits took 164.3 ms. No new index was added.

The production browser check passed range discovery, invalid-range blocking, URL canonicalization, one-request Apply, keyboard tabs, and the single mobile scroll pane with no page errors or failed collection responses. Local validation passed TypeScript, the production build, collector and fixture tests, 80 external-indexer tests, isolated SQL integration, and nine fixture browser flows.

Detailed measurements are in [personal-collection-rarity-range-performance.json](personal-collection-rarity-range-performance.json).

## Rollback

To disable only the range feature, set `API_COLLECTOR_RARITY_RANGE_ENABLED=false` in `/opt/yunipals-collector/releases/20260923-rarity-range/collector.env` and restart only `yunipals-collector-api`. The UI hides the range inputs after its capability cache refreshes.

To restore the previous backend, restore `/opt/yunipals-collector/rollout-20260923-rarity-range/collector-api.service.before` as `/etc/systemd/system/yunipals-collector-api.service`, run `systemctl daemon-reload`, and restart only `yunipals-collector-api`. The prior web deployment and frontend-monitor manifest should be restored together for a full rollback.
