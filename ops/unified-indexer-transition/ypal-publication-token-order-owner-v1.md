This inert owner prepares one distinct, derived publication SELECT to test the existing all-ASC token/chronology index's possible backward path. It changes only the token-group direction in the unique `base_latest` fragment:

```sql
ORDER BY event.token_id,event.block_number DESC,event.transaction_index DESC,event.log_index DESC
```

becomes:

```sql
ORDER BY event.token_id DESC,event.block_number DESC,event.transaction_index DESC,event.log_index DESC
```

The original official compiler still runs freshly. The authenticated original full query is `c2cce90adcf317aac802226d6e8d203b109bc5e68337d721057f72e8d9603272` (3,558 bytes), and its relation is `bc47f8a57a2c0c90df56dd367b1217ee0e44ce9acddfe75c6b2206f7744b40ed` (3,133 bytes). The derived full query has its own identity, `4ca00822f6c84d613d94f326bd522a68d5f7df9e38fefbd421b29a334eb95c49` (3,563 bytes); its derived relation is `ddf70426830310056fedc6ea3d672f940d982191b92b3d44928679e665d4aeaa` (3,138 bytes). Exact unique-fragment checks and full reversal enforce that all other chronological ordering, filters, joins, projections and probe bytes remain unchanged. The derived SQL never claims the original query identity or its timing authority.

Changing token-group enumeration preserves the groupwise maximal chronological candidate set. It does not establish a deterministic winner when distinct rows tie on all three chronological fields; the original query does not specify such a winner either. This trial assumes no unproved uniqueness constraint. The finite reference control covers several tokens, duplicate rows and conflicting payload ties, and labels its result as a reference model. It does not execute PostgreSQL or prove which tied row PostgreSQL chooses. The real compiler controls separately verify every unchanged query byte. A matching actual result hash is diagnostic evidence, not a universal equivalence proof or proof of an index scan.

Default invocation prints static metadata and dispatches nothing. Root may explicitly use `--run` once on `yunipals-main`, after separate source review. This creates an exclusive audit directory `/var/backups/yunipals-root-publication-token-order-20261026-1` (0700); all audit files are exclusive 0600 files. The owner authenticates the existing `eaee00ac…` utility and actual prior `fd53eb60…` nonexecuting EXPLAIN, then uses the original compiler and candidate-environment byte/inode bookends. It constructs no application Host, Session or current-proof graph.

The one derived SELECT runs in the original target database OID 17584 through the original peer UID 111/GID 113, empty environment, Unix socket 5432 and read-only transaction. Statement/lock/idle/parent limits remain 60/1/72/80 seconds. The outer diagnostic limit is 140 seconds. The only transaction-local assignment is the original `search_path=pg_catalog`; work memory remains 4 MiB, JIT remains on, and every reported setting must exactly match the authenticated prior settings. There is no GUC trial, DDL, EXPLAIN ANALYZE, original baseline query repeat, service action, provider call or automatic retry. An unknown or failed transport requires inspection; rerunning this namespace is refused.

The private result requires exact integer counts, positive canonical/published equality and a true probe. Raw transport and counts remain private. Public output exposes separate original/derived SQL hashes, the private observation hash, settings, coarse wall duration, and whether the count-result hash equals the prior diagnostic result `17ec72f2…`. Separate snapshots, caches and concurrent movement remain uncontrolled. No causal speedup, current/held qualification, 90-second fit, complete callback, commit permission or rollout acceptance follows from this trial.

Run the portable local controls with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-publication-token-order-owner-v1.test.py
```

Ten controls pass with the actual Node 24.18.1 official compiler and original pure source bytes. PostgreSQL/transport boundaries are mocked. Tests cover unique transformation/refusal/full reversal, unchanged chronological/filter bytes, finite candidate sets and ties, original peer settings/timeouts, typed observations, timeout identity/owned cleanup, private exclusive output, replay refusal and source drift. No database, SSH or Git action was performed by these controls. This packet contains source and fixture evidence only; it includes no production trial result.
