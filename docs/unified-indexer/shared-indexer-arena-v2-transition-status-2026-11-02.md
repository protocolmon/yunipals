# Shared indexer transition checkpoint 2026 11 02

This is the historical preparation checkpoint. See the [2026-11-03 production checkpoint](shared-indexer-arena-v2-transition-status-2026-11-03.md) for the completed source handover and remaining acceptance checks.

The replacement source is qualified and retained for handover. Production readers and Arena v2 source epochs have **not** moved. The temporary candidate and its support processes are stopped; the existing main Ponder process and managed Solana worker continue running. This checkpoint does not establish a completed production transition.

The implementation is on `codex/shared-indexer-arena-v2`, based on main commit `4c669216`. The [implementation plan](shared-indexer-arena-v2-transition-plan-2026-11-02.md) and [handover runbook](../../ops/unified-indexer/shared-transition.md) govern the remaining work.

## Completed preparation

- The compiled replacement enables exactly thirteen sources: eleven retained project feeds, the fighter registry and shared Arena v2. It preserves the registered booster ingestion ABIs and adds explicitly declared Ethereum/Polygon depth-20 policies for existing marketplace consumers.
- Production migration 30 and a reviewed, revocable service RPC profile are installed. Global and workload budgets remain unchanged; no paid replay permits were added. The intermediate profile is disabled; the still-serving main profile is retained.
- Thirty-two legacy or superseded service units are retired and masked. No legacy claims interface or onchain claim/refund/owner transaction was created.
- Source, Arena operational, metadata/derived and configuration/media backups are protected on the server. Main source and Arena operational restore rehearsals passed. Metadata controls/publication pointers were restored with their complete schema dependency closure; the large immutable metadata/archive dataset was backed up but was **not** fully restored.
- Public consumer overlays and protected metadata/publisher inputs are prepared. Existing generation IDs 114 and 113 are preserved in those inputs. Installed reader artifacts, effective selectors and global publication pointers remain unchanged.

## Source acceptance evidence

Qualification finished at **2026-11-02 13:30:59 UTC** for:

| Identity | Value |
| --- | --- |
| Physical schema | `unified_shared_20261102_v2` |
| Native build | `157acd243f` |
| Release | `0x7cd1dada15b9b5fdb141c654e5ab24c976a607e00bd739816f4917ff291ad62b` |
| Read schema | `yunipals_shared_read_20261102_v1` |

The read-only comparison matched **2,218,028 canonical events across all eleven retained sources**, plus **35 registry/Arena v2 events** against the previous shared Arena source. It rechecked current native readiness and compared boundary hashes after hashing. Historical topic padding is decoded with the existing strict receipt decoder; altered topics and invalid interior padding fail verification. No framework headers or checkpoints were inserted to obtain acceptance.

A separate complete public projection comparison found zero differences for four fighters, three v2 tournaments, three credit records and four seats. All thirteen sources passed a final native health probe before the temporary candidate was stopped, with zero candidate restarts. Private provider jobs, signing records, transaction nonces and credits were not reset or rewritten.

The protected source-only report is at `/var/lib/yunipals-unified-shared/qualification-20261102-v2/qualified.json` on `yunipals-main`. It proves that qualification attempt; it does not replace fresh readiness and boundary checks when ingestion resumes. The qualification timer is disabled, and the staged candidate/relays/observer are not enabled for boot.

## Remaining blockers and handover

The unpublished derived-generation preflight refused with **41,157,156,864 bytes free** versus **76,491,331,584 bytes required** under the existing 25 GB minimum-free and 35 GB backup-peak policy. Reserves were not reduced and no partial generation was published.

A second mounted volume has approximately 105 GB free and already holds derived tables. The publisher's current capacity path and temporary inputs use the root filesystem. Using the second volume requires a verified plan for temporary tables, WAL and backup staging as well as derived outputs; pointing the capacity check at a different disk alone is insufficient. Resolve this placement or add root capacity before building the new generation.

After capacity is resolved, resume the retained candidate, refresh its observations and acceptance evidence, adopt native Base metadata, prepare and validate a complete unpublished generation/cache, then migrate every reader and operational consumer through its existing reviewed mechanisms. Transfer the exact source artifact/schema to the canonical supervisor, switch video and anime source epochs separately, and retire the old main source/observer/relay profile after every consumer has moved. Restart/reboot and the 90-minute/24-hour post-cutover observation windows remain outstanding. The staged candidate's earlier qualification is not the start of those windows.

The branch and PR description are prepared. PR creation was refused with HTTP 403 through both the connected GitHub integration and the configured Git credential. Repository push access works; pull-request write access needs to be enabled before the PR can be opened. No PR URL has been created or attached.

## Validation

All application typechecks and web/API builds passed. Indexer Vitest: 66 files, 491 passed, two skipped. Actual Ponder dependency/reorg, ownership, legacy offline, Islands callbacks and canonical parity PostgreSQL checks passed. Supervisor and backup policy checks passed; the repository history, clean source tree and vendor archives passed its secret scan.

The marketplace full run passed 888 of 889 tests. Its existing catalog restart timing test failed once and passed in isolation with unchanged assertions. Thirty-six focused shared-source/stream checks passed, including the reconnect persistence regression discovered during verification. No paid AI generation or owner transaction was used for testing.
