# Combined READ admission v2

Use `ypal-combined-read-admission-v2.py` for the admission protocol described in
[the v1 runbook](ypal-combined-read-admission-v1.md). Preserve the staged v1 bytes:
its default read-only review refused an empty systemd `EnvironmentFile=` reset
before any operation directory, rehearsal or SQL write.

Only three production AST members differ: FORMAT, the new protected operation
BASE, and `consumer_frame`. The observer now applies systemd's ordered empty
EnvironmentFile reset before hashing the final effective files. It hashes every
unit/drop-in definition, excludes inherited files that were reset (including
missing files that are no longer loaded), and records absence only for optional
final paths. Nonempty declarations remain restricted to single absolute literal
paths; quotes, whitespace, specifiers and globs refuse. Final-file changes remain
visible. No declaration, file mode, private value, service or runtime is changed.

The same public `.catalog.sql`, exact private plan/pin, 143-edge SQL, ownership
checks, isolated preservation namespaces, commit/reconcile/owned inverse and
phase-aware validator remain unchanged. Do not publish the private actual plan
or full production observations. No admission acknowledgement is inferred from
successful source staging or an observer check.

The default review and explicit commands now use the v2 filename. The result
format is `yunipals-ypal-combined-read-admission-v2`; its fixed protected directory
is `/var/backups/yunipals-ypal-combined-read-admission-v2-20261024/`. Downstream
owners must bind the new actual result SHA and this exact producer, rather than
accepting v1 as an alias.

```text
python3 ypal-combined-read-admission-v2.py
python3 ypal-combined-read-admission-v2.py --rehearse ACTUAL_REVIEW_HASH
python3 ypal-combined-read-admission-v2.py --commit ACTUAL_REVIEW_HASH
python3 ypal-combined-read-admission-v2.py --validate ACTUAL_RESULT_SHA256
```

The same explicit lost-acknowledgement and inverse commands apply. No operation
implicitly retries SQL or changes workers.

```text
python3 -I -B ops/unified-indexer-transition/ypal-combined-read-admission-v2.test.py
node ops/unified-indexer-transition/ypal-combined-read-admission-v2-postgres.test.mjs
```

The 20 focused controls retain the prior17 and add production-shaped reset,
unused-file/optional-file handling, final-file drift/nonliteral refusal and AST
scope checks. The PostgreSQL fixture is the same disposable synthetic143-edge
transaction/inverse exercise, rebound to the exact v2 source. Actual read-only
qualification additionally verified the four existing units' final effective
file hashes; detailed observations remain private/local. Native readiness,
production grants and consumer selection remain separate actions.
