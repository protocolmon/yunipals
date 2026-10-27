# Inactive ordinary chain-observer runtime

This package adds an observer-only entry to the accepted consumer runtime.
It uses the unchanged official release reader, chain observer, RPC factory and
transport preflight. It does not index events, process receipts, register a
release, publish a generation or select readers.

The artifact is `8c713a57dde009540564619e45de8b487af77787faf4f07a916d340d710a8753`.
Its manifest SHA256 is
`a09e273ba1bacbb72f9722c1c40e9a1242ce9d003bab658b93a573aa233117a2`.
The builder verifies 34 source/resolution inputs. Only the new observer entry
differs from the accepted baseline; the dependency, transport and historical
ABI snapshots retain their exact prior bytes.

The entry fixes the combined release, schema, build, four free-only endpoints
and full profile hash. It strips unrelated transport inputs and refuses replay
permits. One dedicated database connection holds a release-specific session
lock; the other runs the official short transactions. Each chain has one
observation loop with the existing delay. These loops update only the ordinary
control observations and anchors; they do not modify native indexed tables.

Use Node 24.18.1 from the repository root:

```sh
node ops/unified-indexer-transition/ypal-combined-ordinary-observer-build-v1.mjs --out /absolute/fresh/output
node ops/unified-indexer-transition/ypal-combined-ordinary-observer-build-v1.test.mjs
NODE_BINARY=/absolute/path/to/node24 python3 -B ops/unified-indexer-transition/ypal-combined-ordinary-observer-install-v1.test.py
```

The five build/import/relocation groups and four self-building installer controls
pass. The entry also passed 18 focused controls, eight genuine PostgreSQL groups
and independent review. The PostgreSQL fixture uses a limited role, refuses
native/receipt writes and exercises singleton, stale-runtime, canonical-branch
and finality behavior through the unchanged observer.

The exact bundle is installed inactive. Actual host default review, protected
installation and independent receipt/layout/dependency/syntax checks passed.
No application was imported on production; no database/provider call, unit
creation or observer start occurred through this installer. Its default command
is read-only; explicit installation requires the actual returned review binding:

```sh
python3 /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-ordinary-observer-install-v1.py
python3 /opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-ordinary-observer-install-v1.py --install --expected ACTUAL_REVIEW_BINDING_SHA256
```

The separate [activation owner](ypal-combined-ordinary-observer-owner-v1.md)
requires actual read-admission and installation receipts. Its exact owner and
dormant serving template are staged, but activation has not run. The serving
template has no runtime expiry. Its later qualification checks its own source,
profile, role, code and invocation, while the reader coordinator separately owns
its cache and API permission changes. Final supervisor adoption or retirement of
this observer's exact activation remains a later explicit transition.
