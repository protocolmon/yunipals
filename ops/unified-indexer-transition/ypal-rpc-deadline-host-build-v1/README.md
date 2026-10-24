# Isolated production-host deadline build

This owner evaluates the reviewed `690b6dda…` transport using the installed
Ponder 0.17.5 runtime and the original five-connection configuration. Its local
reference build retains `71e2a7f3b7` and all three config/schema/handler hashes.
The actual host evaluation is a separate prerequisite for later managed-runtime
adoption.

The source context is the actual `994/de4/0ee` restored epoch. Two scoped
observations surround the build, checking the source, pack source/API, original
private/public input fingerprints, nine-RPC component and native/cache identity.
Normal checkpoint progress is allowed; the recorded safe recovery floors must
remain valid. No old c96 process validator is reported passed.

One fresh transient unit runs as the existing UID970/GID964, with a two-GiB memory
limit, one-CPU quota and 120-second runtime limit. Its clean environment uses only
the existing public configuration and an unreachable fixture database URL. Network
access and database socket paths are denied. The public build entry intercepts
all twelve preflight requests with explicit fixtures and refuses socket attempts.
It evaluates config, schema and handler code without starting an indexer.

All three writable cache bindings use the new isolated cache area. The three
read-only bindings retain the original config and booster config and select the
new transport. No empty bind-list reset is used. Existing files, live units,
private configuration, source selections and boot paths retain their ownership.

The new staging directory contains the five files in this package, plus exact
public copies of these already-published files:

- `ypal-rpc-deadline-v1/rpc-preflight.ts` as `rpc-preflight.ts`, SHA `690b6dda…`.
- `ypal-rpc-deadline-offline-build-v1.mjs` as `offline-build.mjs`, SHA `e644eefe…`.

The operator stays root-only. Public JavaScript/TypeScript inputs are root-owned
0644 beneath protected 0755 directories so the transient user can read them.
Private audit files remain root700/root600. Staging must compare or exclusively
create files, with no overwrite of accepted source.

Default execution performs a read-only review. After inspecting that concrete
review, use its exact hash for the single build:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-rpc-deadline-host-build-v1/probe.py
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-rpc-deadline-host-build-v1/probe.py --apply ACTUAL_REVIEW_SHA256
```

The intent, cache area and output directory are exclusive. After an interrupted
observation, inspect the same transient unit and owned audit files; do not start
another build. Success requires its collection, actual UID/GID, exact local
contracts/build hashes and preserved serving identities. This owner cannot change
the running transport, grant permissions or qualify canonical source readiness.

Nine local controls cover isolation/mounts, wrong review, successful evaluation,
legitimate checkpoint progress, changed peers, regressing recovery floors,
unknown acknowledgement and an uncollected transient. They use explicit fixtures
and perform no host or provider action.
