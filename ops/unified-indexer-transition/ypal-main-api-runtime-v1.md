# Main API indexed-action successor

This is an inactive, MAIN-only artifact. It contains the exact reviewed
historical booster ABI catalog and chain-qualified YPAL action checks from the
published source change. Installation neither imports the application on the
host nor selects a source, changes credentials, starts a service or publishes a
generation. The accepted consumer runtime and the separate live booster API
remain untouched.

Artifact digest:
`40e35c622534b9030622759116cf3b85361ad914211a76a7fd47ee06b60968f9`.
Manifest SHA256:
`986a288dcebe5e7ce910b36d83f97178ce7c47336a0e9910e0d013e3ff3e347a`.
The only runtime entry is `dist/main-api.mjs`, with its source map.

The builder pins the accepted consumer source inventory and compiler. Its 94
source/resolution inputs have exactly six allowed differences:

- `action-evidence.ts`: exact manifest ABI selection and chain-qualified request
  and original identity checks.
- `indexedAction.ts`: decode with the selected full source ABI.
- `boosterSourceAbi.ts` and `boosterSourceAbi.e8145098.ts`: explicit full ABI
  catalog, including the retained historical engine and monster descriptors.
- `boosterAbi.ts`: the exact catalog dependency for its other already-reviewed
  ABI version; no contract deployment or active source definition changes.
- `event-topics.ts`: the existing accepted stored-topic normalization dependency.

Unknown full ABI hashes still refuse. Canonical raw log decoding, normalized
arguments, projection identity, read selection, source coverage and freshness
checks remain required. The marketplace receipt requirement remains unchanged;
this package does not run the receipt worker or accept synthetic marketplace
proofs.

Unrelated current changes are deliberately excluded. Five exact baseline source
files under `ypal-main-api-baseline-v1/` retain the accepted API routes/OpenAPI,
leaderboard refresh, generation refresh and shared booster DTO source. Their
bytes are checked against the accepted inventory before compilation, and every
compiled source-map body is checked against its actual inventory input in the
build tests. Package declarations and lock data use the already retained
baseline snapshots. Dependencies are linked rather than installed or copied.

## Offline build and checks

Run with Node 24.18.1 from the repository root. The output path must be fresh.

```sh
node ops/unified-indexer-transition/ypal-main-api-build-v1.mjs --out /absolute/fresh/output
node ops/unified-indexer-transition/ypal-main-api-build-v1.test.mjs
NODE_BINARY=/absolute/path/to/node24 python3 -B ops/unified-indexer-transition/ypal-main-api-install-v1.test.py
```

The five build groups prove exact outputs and source maps, repeated and relocated
byte-identical compilation, real application import with no network, malformed
HTTP request refusal before database access, and changed reviewed source
refusal. The four installer controls build their own fresh artifact, then test
exclusive installation, exact validation, modified output and foreign file
refusal. They also compare the retained dependency and filesystem algorithms
with the previously accepted installer.

For the actual bundled HTTP action route against the existing disposable local
PG16 fixture, run from `apps/yunipals-indexer`:

```sh
node --import tsx ../../ops/unified-indexer-transition/ypal-main-api-v1-postgres.test.mjs
```

That test creates and cleans its own database and SELECT-only login role. All
inserted event arguments, block hashes, runtime and coverage witnesses are
synthetic. The known public YPAL transaction hash labels the scenario; it does
not make those rows production evidence. The genuine PostgreSQL tests exercise
selection, historical ABI decoding, chain-qualified projection identity,
canonical conflict, argument mismatch, stale runtime and foreign read-selection
refusal through the actual built app. The role has no application write rights,
and the HTTP transactions are read-only. No provider is invoked.

## Explicit inactive installation

Stage the four exact artifact files at the installer's fixed incoming directory,
with the `dist` subdirectory, and stage the exact public installer. Its default
command reviews files and external package resolution against the accepted
runtime inventory only:

```sh
python3 /opt/yunipals-unified/operations/free-replay-20261020/ypal-main-api-install-v1.py
python3 /opt/yunipals-unified/operations/free-replay-20261020/ypal-main-api-install-v1.py --install --expected ACTUAL_REVIEW_BINDING_SHA256
```

The explicit install requires the returned binding and creates a fresh immutable
content-addressed directory plus protected intent/result. It refuses existing
targets. It verifies actual ESM and CommonJS dependency entries without importing
application code. The consumer transition owner must authenticate the resulting
receipt with `installed(shared(), actual_result_sha256)` and independently own
the eventual unit/environment/source selection and inverse. This installer does
not amend any old hash-pinned consumer validator or imply that its old whole
validation passed with the replacement artifact.

Production acceptance remains separate. The prior protected known-transaction
probe established its actual ABI/request mapping, but was not a covered-point
MAIN API preview and lacked its historical canonical block witness. This package
claims neither current source readiness nor that positive preview. The eventual
on-host preview must use the actual selected release and read identity, genuine
canonical event and block evidence, current coverage and projection rows. Full
MAIN routes additionally require the coordinated generation/readers/cache
boundary; a passing isolated action-route fixture does not authorize early
global pointer publication or a serving switch.
