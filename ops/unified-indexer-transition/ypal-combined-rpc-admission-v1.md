# Combined profile admission and separate RPC routes

This owner admits the twelve-source combined profile without changing the existing four d059 routes, the fresh YPAL route19212, or either source. It preserves YPAL source, API, owned boot links, queue/timer definitions, accepted type1 configuration and database read permissions using their acknowledged receipts. The initial review qualifies the old combined source once; subsequent checks remain valid after its separately controlled drain.

The official runner is the previously tested runner with only its fixed approval-file path changed. It executes the installed official policy CLI, including its review hash and insert-only behavior. Expiry remains2026-11-19T18:00:00Z; no replay permits are created and budget/counter rows remain unchanged.

## Current startup gate

`SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA` is intentionally unset. `--start` refuses before any mutation. The actual budget database role has a connection limit of16 and currently8 sessions. Each retained proxy can use2 connections, so five retained proxies plus four new max2 pools could reach18. A separately reviewed artifact limiting only the four new proxy pools to1 is required before a successor may start them. The frozen admission receipts are not rewritten for that successor.

The current owner contains the four-route lifecycle and inverse for review, but it cannot execute startup. Intended ports are Ethereum19221, Base19222, Polygon19223 and BNB19224. Unit names are `yunipals-combined-rpc@<chain>.service`. Each inherits its corresponding existing hardened proxy entry and private inputs; the proposed public overlay selects the full combined profile and explicitly disables all seven paid-routing flags. The max1 successor must also bind its new artifact and actual connection-capacity check.

## Admission phases

Public inputs already staged at `/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-v1/{profile.json,approval.json,official.mjs}` are inert. Stage the frozen owner separately; do not overwrite an existing owner or result. Run on `yunipals-main` with the established E0 root launcher, clean environment and Python `-I -B`. The owner uses fixed peer database access and exposes no credentials.

1. Run `ypal-combined-rpc-admission-v1.py` without arguments. This is read-only and prints `reviewHash`. It requires the operation directory and all four new units/ports to be absent. The public input directory may already exist.
2. Run `--rehearse REVIEW_HASH`. It repeats the fresh review, saves its protected binding, executes the official transaction with ROLLBACK, and proves the catalog unchanged. The operation directory is `/var/backups/yunipals-ypal-combined-rpc-admission-v1-20261023`.
3. Run `--commit REVIEW_HASH`. A durable one-shot intent precedes the official INSERT. Success writes `admitted.json` after direct retained-state and exact catalog checks. This admits policy only; it neither starts a unit nor grants paid authority.
4. If commit acknowledgement is lost, do not repeat commit. After the command is terminal, run `--reconcile COMMIT_INTENT_FILE_SHA256`; it can acknowledge only the exact already-present row and never reissues SQL. Absence or a different row remains a refusal.

All saved files use exclusive writes, protected parent directories, file and directory fsync, and exact input hashes. One operation flock and a900-second outer bound cover the finite fixed phases. The database CLI has its own40-second bound. A process timeout is not proof that a mutation failed; inspect the one-shot intent before reconciliation.

## Intended route acceptance and inverse

The future startup successor must preserve the reviewed four-route behavior: publish only new owned files, verify loaded hardening, start each fixed unit once with the service's130-second bound, validate both unified workloads and free-only metrics, then create only its owned boot link. No blockchain RPC is needed for HTTP preflight. `reconcile-start` observes an already-completed transition; it does not start missing units or recreate missing links.

The fixed `validate_current(receipt_sha)` interface checks acknowledged actors, exact owned files, full profile/preflight, unchanged catalog and direct YPAL invariants. It does not call the original combined-source qualifier after the initial review.

Before route inverse, the new `yunipals-ypal-combined-source.service` must be terminal, have no manager job, and have an empty cgroup. The inverse fences each exact owned actor immediately before stopping it, removes only operation-owned unit/env/boot inodes, and preserves the admission row and all counters. It never stops or restarts old routes, old sources, YPAL, API, or queue. A partial/unknown stop is not blindly retried. Source stop/start and shared-cache handover remain the separate source controller's responsibility.

## Local evidence

-21 focused Python tests pass, including profile/expiry/no-permit binding, SQL intent/lost-ACK controls, direct baseline after old-source drain, same-UID process proofs, accepted catalog/freshness drift rejection, owned inode handling, inverse actor fence and closed startup gate.
-5 official-runner controls pass; the optional PostgreSQL test is skipped unless `YPAL_RPC_TEST_DATABASE_URL` is provided. No claim of a fresh local SQL execution is made from these mocks; production ROLLBACK is a required phase before INSERT.
-The authorized read-only budget capacity receipt is `/tmp/yunipals-combined-rpc-budget-capacity-20261023.json`, SHA256`7765cb93bfdb2a75d49c845e16bfba1135f5a13ac5ecd1017330054c89cb1189`. No role limit, service, policy or provider call changed during that check.

Commands: `python3 -B ops/unified-indexer-transition/ypal-combined-rpc-admission-v1.test.py`; Node24 with the existing tsx loader runs `ypal-combined-rpc-official-v1.test.mjs`. The owner and runner must remain frozen after the actual admission attempt.
