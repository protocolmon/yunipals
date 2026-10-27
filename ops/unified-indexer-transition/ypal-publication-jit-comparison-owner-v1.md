# Exact publication query: diagnostic JIT comparison

This operator is inert by default. Root may deliberately run it once with `--run` on `yunipals-main`, using a new exclusive `/var/backups/yunipals-root-publication-jit-comparison-20261026-1` audit directory. It performs two read-only database transactions and changes only each transaction's local `jit` setting. It does not change a worker, service, persistent database setting, index, schema, work_mem, permission, input, or receipt from an earlier run.

The operator authenticates the actual nonexecuting EXPLAIN receipt `fd53eb603e450e6ee8e9aa9a77929eb36ea883292cdd3659b0cdb5b73adb9ac3` at the original EXPLAIN audit's `result.json`. It authenticates and reuses the frozen `ypal-publication-explain-owner-v1.py` (`eaee00ac1f5a09d7c2b76082220563c882ea4269798113e2ebe0237831bab3e4`) to freshly compile the exact original `cf779` publication method through the genuine `deea` capture seam. No application Host or worker is constructed.

Fresh compilation must reproduce the actual 3558-byte full query `c2cce90adcf317aac802226d6e8d203b109bc5e68337d721057f72e8d9603272` and 3133-byte relation `bc47f8a57a2c0c90df56dd367b1217ee0e44ce9acddfe75c6b2206f7744b40ed`. The full count/probe wrapper and every official relation predicate execute unchanged. The compiler sources and private selector environment receive fresh hash/inode bookends; environment contents and query text are not exported.

The first fixed peer transaction sets `SET LOCAL jit=on`; the second sets `SET LOCAL jit=off`. Both use the original OS peer user/group, clear environment, Unix socket, postgres role, `yunipals_backfill` OID17584, `BEGIN READ ONLY`, `search_path=pg_catalog`, 60-second statement timeout, 1-second lock timeout, 72-second idle transaction timeout, 80-second parent communicate timeout, and terminal `ROLLBACK`. Each transaction checks the actual database identity and exact scalar settings from the accepted EXPLAIN, with only `jit` differing. No ANALYZE or EXPLAIN ANALYZE is requested. The outer 200-second alarm covers the fresh compiler and two individually unchanged 80-second transports; it does not extend either query's timeout or any production held-transaction policy.

Actual count/probe result objects stay in exclusive private0600 audit files. Public output contains their canonical hashes/equality, settings, transport hashes/lengths and wall times. The reported wall includes process startup and the identity/settings queries. This is one fixed on→off pair across separate transaction snapshots. Cache warming, concurrent data movement and scheduling are uncontrolled. A matching result pair does not establish equivalence for other snapshots; a mismatch suppresses the wall-time ratio. The result explicitly disclaims causal performance qualification, current-source authority and held qualification. It cannot be used as a production callback/timing receipt or as an authorization for a mutation.

A failed or timed-out command is never retried. Partial observations and the new audit are retained. The original production query, its peer, all current predicates and the existing 90-second approval/five-second tail contract remain unchanged.

Run portable local controls with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-publication-jit-comparison-owner-v1.test.py
```

The public EXPLAIN fixture contains only the already public aggregate/scalar result. Its canonical record, after removing the root output's `resultSha256`, must hash to the actual `fd53` receipt. The real compiler control uses repository source and an explicit public selector fixture, never a production environment file or database. It locates exact Node24.18.1 through `YUNIPALS_PUBLICATION_TEST_NODE`, the fixed production runtime path if locally present, or the home NVM runtime path. Only that control may skip if the explicit runtime is unavailable; a skip is not proof of compiler reproduction. The current local run passed all nine controls with no skips.

The official PostgreSQL references explain that [JIT is selected from plan cost](https://www.postgresql.org/docs/16/jit-decision.html), [SET LOCAL lasts for the transaction](https://www.postgresql.org/docs/16/sql-set.html), and [EXPLAIN without ANALYZE does not execute the plan](https://www.postgresql.org/docs/16/sql-explain.html). This diagnostic deliberately executes the exact SELECT twice; its accepted predecessor only planned it.
