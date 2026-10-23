# Four combined RPC routes

This controller starts only the new combined-profile proxies on Ethereum19221, Base19222, Polygon19223 and BNB19224. It consumes the actual v3 admission receipt `b47cd241…` and inactive artifact-stage/import receipt `30275738…`; it never runs policy SQL again.

The pool1 artifact `8afd0184…` changes exactly one compiled byte from existing v6: the budget pool maximum2→1. Existing proxies retain their artifacts and pools. The controller verifies the actual staged dependency-link inode, exact retained release context and pg/viem entry hashes. The staged artifact/link are retained on inverse; this controller owns only four new env, unit and boot-link publications.

The budget role remains limited to16 connections, with96 global connections and3 reserved. Before every start, the controller accounts for five retained max2 pools, all four new max1 pools and two reserve slots. It refuses insufficient capacity or changed limits; it never changes a role, privilege, budget, permit or counter.

## Execution

Run the frozen file on `yunipals-main` with the established E0 root launcher and clean environment. The owner file is `/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-routes-v1.py`. Its evidence directory is `/var/backups/yunipals-ypal-combined-rpc-routes-v1-20261023`.

1. Default invocation performs a read-only review and prints `reviewHash`. It authenticates the actual admission, immutable artifact/context, full profile, retained old proxies and direct fresh YPAL source/API/queue/catalog state, and all four absent new unit/env/boot paths and free ports.
2. `--start REVIEW_HASH` repeats the fresh review, saves its binding and exact admission acknowledgement, then uses the frozen v3 owned lifecycle: durable one-shot intent, exclusive publication, loaded hardening verification, each fixed service start, both workload preflights/free-only metrics, owned boot links, final exact actor acknowledgement. Each manager operation is bounded to130 seconds and the controller to900 seconds.
3. Success writes `result.json`. Pass its SHA256 to `--validate SHA` or the imported `validate_current(SHA)` interface. The result includes profile file hash, all four endpoints, exact route actors, and `oldCombinedSourceLivenessRequired:false`.

After the initial admission qualification, all route checks use direct retained evidence. They do not require old source716994 to remain running. The fresh YPAL source/API/19212 route remain live and bound to their accepted receipts and native catalog. The separate source controller performs the old drain and new combined source start.

Both controllers use exclusive nonblocking `/run/lock/yunipals-ypal-combined-transition.lock`. The new source must not start concurrently with route inverse. Imported source-facing helpers are `core()`→`(m, owner)`, `retained(m)`, `source_query(m, sql)`, `live_actor(m, state, expected=None)` and `state(m, unit)`. Constants belonging to the retained helper are available at `m.route_owner`.

## Lost acknowledgement and inverse

Never blindly repeat a start. `--reconcile-start INSTALL_INTENT_SHA` only observes an already-completed four-route transition and writes its acknowledgement; it never creates a missing unit/link or dispatches another start. A partial transition remains inspectable through the durable per-unit intents and publication records.

After the new combined source is stopped with no job and an empty cgroup, `--restore INSTALL_INTENT_SHA` stops only exact owned actors in reverse order and removes only their operation-owned env/unit/boot inodes. It preserves the admission row, staged artifact/context, all counters, old routes and YPAL services. The exact process/file/env/capability/start identity and immediate pre-stop CAS are mandatory; successful HTTP/database health is deliberately not required to stop an owned failed proxy. There is no automatic source restart or retry after an uncertain manager outcome.

## Verification scope

15 focused local tests pass. They cover actual canonical admission/stage fixtures, budget capacity and unchanged limits, final-command-only rendering, direct baseline after old source drain, stale review refusal before filesystem writes, exact acknowledgement copy, frozen lifecycle reuse, start-only capacity gating and owned-stop identity independent of health. The previously reviewed27 v3 controls and five pool1 artifact controls remain applicable. No service or provider request was made by these local tests; actual route preflight follows deployment.
