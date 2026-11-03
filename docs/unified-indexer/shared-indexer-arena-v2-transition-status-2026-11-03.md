# Shared indexer production checkpoint 2026 11 03

The shared-source handover, final encrypted recovery backup and automatic host reboot recovery are verified. Later stability checks exposed BNB ingestion lag and catalog queries depending on unrelated chains. The corrections and new acceptance requirements are recorded below. The continuous 90-minute/24-hour observation windows remain open. [PR #15](https://github.com/protocolmon/yunipals/pull/15) remains a draft.

## Source and consumer handover

The final source is `unified_shared_20261102_v2`, native build `157acd243f`, release `0x7cd1dada15b9b5fdb141c654e5ab24c976a607e00bd739816f4917ff291ad62b`. The immutable read schema is `yunipals_shared_read_20261102_v1`. Fresh qualification at **11:00:26 UTC** matched 2,218,277 canonical events from all eleven retained project feeds and 35 registry/Arena v2 events, with fresh native readiness and boundary checks after comparison. No synthetic headers or framework checkpoints were inserted.

At **13:32 UTC**, ingestion transferred to `yunipals-indexer.service` using the exact qualified artifact, schema and source settings. Its supervisor manages one Ponder process and the preserved Solana adapter. The Solana directory and protected settings are unchanged. Duplicate supervisor exclusion passed. The temporary candidate, obsolete combined observer and old combined relays are stopped, disabled and masked. The old main RPC profile is disabled; the final service profile retains the existing budgets and has no paid permits. Ordinary application RPC routes remain in use.

Generation **127** was published through the official coordinator at **12:18:23 UTC**, retaining generation 114 as previous. The generation contains 1,072,868 search/revision rows and 11,811,997 trait rows; the coordinated publication includes 512,350 wallet rows and the prepared four-chain read caches. A prior attempt stopped before its transaction intent because Base cache revision changed. The successful retry retained all freshness and publication-lock checks. Normal publication subsequently advanced to **129**, with **127** as previous, at 15:08 UTC. Its source release/read identity and ready state were verified after both reboots; generation IDs are not frozen during normal operation.

Main API, collector, metadata, Islands, leaderboard, read cache and booster consumers now select the final source. Ethereum Islands ownership and metadata matched all 898 active tokens. Its staking support retains the existing role, 500-token/128-RPC/120-second limits and schedule. The booster artwork queue timer is restored.

All five Marketplace operational consumer switches were reviewed and applied through the existing exact-hash CLI. Twelve Marketplace services were migrated with the existing provider settings, chain policies and spending limits. Private order hashes matched before and after. The production source login has only the required read/probe privileges. API readiness and native BNB discovery respond successfully. A correlated ownership lookup avoids sorting the full native view before applying the catalog page limit. Its deployed correction passed default/raw/capped rarity sorting, token ordering and distinct snapshot pagination under unchanged timeouts. Publishing workers resumed after source recovery; the read-only stream and all three discovery jobs now run successfully with their existing credentials, schedules and limits.

Video and anime Arena v2 now have separately reviewed source epochs. The switch preserved all thirteen protected record sets exactly, including submissions, encrypted inputs, provider tasks, transaction intents, signing records, media and client transaction history. Original availability was restored, capacity refreshed and both APIs returned healthy source/tournament responses. No old tournament migration, claims interface, owner transaction, paid AI smoke test or provider-job reset was performed.

## Storage, native metadata and recovery

The explicitly approved tablespace permission is applied. Five backup/recovery workspaces use persistent mounts on the extra volume, with checksums and permissions preserved. Capacity checks retain the existing free-space, backup and WAL reserves. Read-cache index maintenance reclaimed approximately 6.97 GB without changing rows or index definitions.

Native Base approval now has a separate bounded refresh timer so long metadata publication scans cannot prevent its two-minute proof from being renewed. It uses the existing metadata writer identity and advisory lock, with ordinary production Base point reads. The full metadata scan batch is 100; its former source-specific Base relay was replaced with the existing ordinary production endpoint. Approval expiry, source checks and financial authority are unchanged.

Canonical recovery archives preserve the exact source/dependencies, Node executable, preserved Solana/core artifacts, deployed support/workers and protected service inputs. The encrypted restore drill completed at **14:24 UTC** and verified private keys, encrypted strategies, unfinished provider IDs, quarantined restoration and recovery binaries. It made zero provider requests and broadcast zero transactions. The consistent post-handover source/metadata dump restored 2,218,332 canonical events, generation 127, seventeen mutable metadata control tables and the exact immutable read binding; every compressed data stream decoded successfully. The fresh Marketplace backup restored all 43 tables and verified all five current selections in a Unix-only cluster with NOLOGIN placeholder roles. The independent Solana snapshot restored with its original manifest. Large immutable metadata is backed up and its archive streams verified; it has not been fully materialized in a second database.

The final recovery set contains nineteen artifacts totaling approximately 7.46 GB, plus its manifest. Every current artifact/hash and the manifest were found in the completed encrypted backup cache before reboot. The final boot-setting refresh completed encrypted backup at **16:22 UTC**. Both disposable restore clusters are stopped, with protected fixtures retained. A post-reboot read-only capacity check passed for generation and leaderboard builds under the unchanged reserves: root had 54.69 GB free against at most 49.84 GB required; the extra volume had 83.64 GB free against at most 80.74 GB required.

The new production monitor passed at **15:21 UTC**, covering all thirteen sources, one Ponder plus Solana, 48 services, current schedules, local/public reads and existing budget policy hashes. Three obsolete monitors that expected retired services/artifact paths are masked with rollback definitions retained. The source and budget probes run as existing accounts using Unix sockets, read-only SQL and no capabilities. The main monitor has no user-switch capabilities. Its observation window resets after a failure, reboot, configuration change, reversed clock or gap over three minutes. Five regression tests cover window continuity and stale/foreign probe rejection, and run in CI.

The first host reboot verified a new boot and recovered all thirteen sources and
Arena automatically. It exposed two Marketplace startup gaps: continuous sale
readers had no boot registration, and five-second publisher retries exhausted
the existing five-start/two-minute limit during source recovery. The three
already-continuous read-only sale readers are now enabled for boot, and all
thirteen Marketplace API/worker services retry failures thirty seconds apart.
Existing restart limits, source checks, private configuration, schedules and
financial controls are unchanged. A second host reboot verified this correction
with no manual application starts after boot. Canonical Ponder and observer
restart counts are zero; one Ponder plus the preserved Solana child own ingestion.
Arena epochs, Marketplace selections, private record counts and both protected
source/Solana configuration hashes match the pre-reboot proof. The existing
50,665,222-byte anime film still matches its original publication checksum.

Staking's strict finalized-header proof briefly became unavailable as finality
crossed the native-header restart gap. Its existing scheduled task recovered
without fabricated headers, relaxed verification or a changed schedule. The
first acceptance window restarted at **16:50:52 UTC** and was subsequently
invalidated by the Marketplace failures. Its previously estimated completion
times no longer apply.

## Marketplace stability correction

The dedicated shared-source RPC services now use two-second free-provider
attempts, leaving time for failover inside Ponder's ten-second request deadline.
The prior ten-second provider attempt could exhaust the caller's deadline before
a fallback succeeded. BNB subsequently caught up and source reads recovered.
Existing endpoint pools, pacing, concurrency, response limits, source policies,
profile and monetary controls are unchanged; paid calls remained zero. Ordinary
application RPC units do not load the new timeout overlay.

Catalog source checks now qualify only requested chains against the same held
snapshots and existing bounded read lanes. Qualification uses savepoints so a
refused chain cannot abort other verified chains' snapshots. Visibility and final
ownership queries explicitly restrict token/history scans to the selected
collections, including foreign-table scans. Empty pages still require source
proof; pagination cannot introduce an unqualified chain. The three-generation
and connection limits are unchanged.

Regression verification includes a real halted BNB source in the disposable
PostgreSQL fixture: Base catalog, listing filters and empty pages remain usable;
BNB and combined requests are refused; concurrent Base reads and existing
snapshots survive the refusal. Native ownership/catalog regressions passed,
alongside the existing RPC proxy cases, API build and TypeScript checks.

The authoritative acceptance record is
`/var/lib/yunipals-unified-shared/production-health/latest.json` and its protected
history. Use its new `healthySinceUnix` after deploying the correction; any
failure, reboot, configuration change or monitoring gap resets the window. The
PR description records the deployed artifact and current observation start.

## Acceptance still required

- Complete the 90-minute and 24-hour healthy observation windows. The earlier candidate qualification and encrypted restore drill do not satisfy these windows.

Implementation commit `03e956ca` passed CI, including the startup configuration and monitor checks. Indexer verification passed 503 tests with two skipped; actual PostgreSQL publication/cache verification passed 24 groups with the production single-connection pool. Rarity checks passed 336 pagination and 144 trait cases. The native catalog regression passed all 15 ownership integration tests, and its API TypeScript check passed. The full API run passed 888 tests; its sole failure was a test-admin URL selecting the wrong disposable database. All three tests in that integration file then passed with the required database selected, including the restricted sale-worker grant test. All 889 cases are covered by those runs.
