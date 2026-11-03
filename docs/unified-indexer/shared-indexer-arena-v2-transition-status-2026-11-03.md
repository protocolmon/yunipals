# Shared indexer production checkpoint 2026 11 03

The canonical indexer and application consumers now use the qualified shared source. The transition remains under acceptance: the Marketplace catalog correction, remaining worker/monitor failures, host reboot recovery and the 90-minute/24-hour observation windows are still open. [PR #15](https://github.com/protocolmon/yunipals/pull/15) remains a draft.

## Source and consumer handover

The final source is `unified_shared_20261102_v2`, native build `157acd243f`, release `0x7cd1dada15b9b5fdb141c654e5ab24c976a607e00bd739816f4917ff291ad62b`. The immutable read schema is `yunipals_shared_read_20261102_v1`. Fresh qualification at **11:00:26 UTC** matched 2,218,277 canonical events from all eleven retained project feeds and 35 registry/Arena v2 events, with fresh native readiness and boundary checks after comparison. No synthetic headers or framework checkpoints were inserted.

At **13:32 UTC**, ingestion transferred to `yunipals-indexer.service` using the exact qualified artifact, schema and source settings. Its supervisor manages one Ponder process and the preserved Solana adapter. The Solana directory and protected settings are unchanged. Duplicate supervisor exclusion passed. The temporary candidate, obsolete combined observer and old combined relays are stopped, disabled and masked. The old main RPC profile is disabled; the final service profile retains the existing budgets and has no paid permits. Ordinary application RPC routes remain in use.

Generation **127** was published through the official coordinator at **12:18:23 UTC**, retaining generation 114 as previous. The generation contains 1,072,868 search/revision rows and 11,811,997 trait rows; the coordinated publication includes 512,350 wallet rows and the prepared four-chain read caches. A prior attempt stopped before its transaction intent because Base cache revision changed. The successful retry retained all freshness and publication-lock checks.

Main API, collector, metadata, Islands, leaderboard, read cache and booster consumers now select the final source. Ethereum Islands ownership and metadata matched all 898 active tokens. Its staking support retains the existing role, 500-token/128-RPC/120-second limits and schedule. The booster artwork queue timer is restored.

All five Marketplace operational consumer switches were reviewed and applied through the existing exact-hash CLI. Twelve Marketplace services were migrated with the existing provider settings, chain policies and spending limits. Private order hashes matched before and after. The production source login has only the required read/probe privileges. API readiness and native BNB discovery respond successfully. The default catalog rank query needs a correlated ownership lookup to avoid sorting the full native view before applying its page limit; the correction passes the live dataset under the unchanged timeout and has actual database regression coverage. Its production deployment and remaining publishing-worker failures are still being verified.

Video and anime Arena v2 now have separately reviewed source epochs. The switch preserved all thirteen protected record sets exactly, including submissions, encrypted inputs, provider tasks, transaction intents, signing records, media and client transaction history. Original availability was restored, capacity refreshed and both APIs returned healthy source/tournament responses. No old tournament migration, claims interface, owner transaction, paid AI smoke test or provider-job reset was performed.

## Storage, native metadata and recovery

The explicitly approved tablespace permission is applied. Five backup/recovery workspaces use persistent mounts on the extra volume, with checksums and permissions preserved. Capacity checks retain the existing free-space, backup and WAL reserves. Read-cache index maintenance reclaimed approximately 6.97 GB without changing rows or index definitions.

Native Base approval now has a separate bounded refresh timer so long metadata publication scans cannot prevent its two-minute proof from being renewed. It uses the existing metadata writer identity and advisory lock, with ordinary production Base point reads. The full metadata scan batch is 100; its former source-specific Base relay was replaced with the existing ordinary production endpoint. Approval expiry, source checks and financial authority are unchanged.

Canonical recovery archives preserve the exact source/dependencies, Node executable, preserved Solana/core artifacts, deployed support/workers and protected service inputs. The encrypted restore drill completed at **14:24 UTC** and verified private keys, encrypted strategies, unfinished provider IDs, quarantined restoration and recovery binaries. It made zero provider requests and broadcast zero transactions. A current post-handover database restore point and final artifact/configuration refresh are still being prepared. The earlier large immutable metadata archive is backed up; it has not been fully restored.

## Acceptance still required

- Deploy and verify the catalog correction, resolve remaining live worker failures, and update health checks that still expect retired services.
- Refresh the final recovery set and verify the current source/control and publication restore point.
- Reboot the host, then verify boot ownership, one Ponder plus Solana, all thirteen sources, public reads, private job recovery and unchanged budgets.
- Complete the 90-minute and 24-hour healthy observation windows. The earlier candidate qualification and encrypted restore drill do not satisfy these windows.

The latest committed implementation CI passed all seven jobs. Indexer verification passed 503 tests with two skipped; actual PostgreSQL publication/cache verification passed 24 groups with the production single-connection pool. Rarity checks passed 336 pagination and 144 trait cases. The native catalog regression passed all 15 ownership integration tests, and its API TypeScript check passed. The full API run passed 888 tests; its sole failure was a test-admin URL selecting the wrong disposable database. All three tests in that integration file then passed with the required database selected, including the restricted sale-worker grant test. All 889 cases are covered by those runs.
