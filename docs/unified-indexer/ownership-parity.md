# Fixed-boundary ownership comparison

`ops/unified-indexer/ownership-parity.mjs` streams the original physical tables
inside one `REPEATABLE READ READ ONLY` transaction. It records sorted SHA256
digests and 256 diagnostic buckets per dataset. It exports no wallet/token rows,
does not create tables and does not select a release. Use Node 24 and the
installed indexer `pg` dependency.

The completed production baseline is
`production-ownership-parity-baseline-2026-10-20.json`; its receipt is
`ownership-parity-capture-2026-10-20.json`. It contains all six collection
identities, their independently captured complete scan boundaries, 1,074,739
tokens/lifecycles and 1,768,735 transfers. It also includes role changes and
Ethereum Islands owner changes. This is the legacy baseline, **not candidate
parity acceptance**.

Compare the candidate against these exact boundaries:

```sh
node ops/unified-indexer/ownership-parity.mjs \
  --source unified \
  --schema REVIEWED_PHYSICAL_PONDER_SCHEMA \
  --release-id REVIEWED_REGISTERED_RELEASE_ID \
  --baseline docs/unified-indexer/production-ownership-parity-baseline-2026-10-20.json \
  --module-root /absolute/release/apps/yunipals-indexer/package.json \
  --database-env PARITY_READ_DATABASE_URL \
  --output /private/new-candidate-report.json
```

The database URL stays in the named environment variable. The output path must
not exist; reports are mode 0600. Only original physical tables are accepted;
copied views/FDWs cannot substitute for a source. Unified capture validates the
registered release/schema/build and each source's chain/address/start/manifest.
It rejects a candidate that has not completely indexed the comparison boundary.

If a source has advanced, token ownership is reconstructed from its last
transfer **at the boundary**, and later burns are removed from the lifecycle
view. A later remint does not hide the earlier owner. Normalized rows retain
all semantic ownership/lifecycle/transfer/role fields; legacy event IDs and
Base Islands' extra block-hash column are not part of the cross-source digest.
Numeric values use decimal strings; nullable fields and booleans remain typed.
Rows have a deterministic order with C-collated text keys and newline-delimited
JSON arrays. Bucket hashes use the same row ordering and SHA256 of the logical
row key to identify a differing subset.

Exit 2 means data differs. Exit 3 means data matches but not every recorded
canonical boundary hash matches. A known contradictory hash fails capture;
missing historical hash witnesses remain explicitly unproved. Legacy Ponder
does not expose an independently verified block hash with its checkpoint in
this capture. Its baseline hashes are null; the two manual scanners' saved
hashes are retained. Establish independently budgeted RPC/canonical witnesses
before accepting production parity. Do not edit the baseline to fabricate them.
Raw matching counts or a successful read-only snapshot are insufficient.

The production invocation streamed this checksum-reviewed program over SSH
stdin. Existing release dependencies were loaded as root, then the process
dropped to the `postgres` uid/gid **before connecting** through its Unix socket;
no application credential was loaded. `--postgres-peer` only permits that local
root-to-postgres transition, and cannot be combined with a database URL.

The transaction uses 8MB work memory, a 512MB temporary-file limit, a 90-second
per-statement timeout, short lock timeout and bounded 2,048-row cursor fetches.
These limits do not establish historical replay capacity or API latency.
The dedicated local PostgreSQL fixture passes four tests covering partial
checkpoints, digest framing, invalid/incomplete baselines, all six source
identities, boundary reconstruction across burn/remint, real data differences
and contradictory witnesses. It never resets the retained shared Ponder test
database.

Metadata/publications, marketplace receipts/discovery, Arena state/private work,
Solana snapshots and public API compatibility require separate comparisons.

## Next capture after the original-window backfill

Source6 changes the RPC proxy; the retained data actor remains source008,
registered release `0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c`,
physical schema `unified_shadow_20261020_7e7375b0`, build `bf4939b3ff`.
Use the existing external `ownership-parity-peer-v2.mjs` (SHA256
`d1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920`),
which clears supplementary groups before connecting.

Run one capture when complete committed coverage reaches Ethereum26,236,452,
BNB128,816,538, Polygon95,883,932 and Base52,870,977. Base's maximum also covers
the Islands boundary52,870,956. Fetch positions are insufficient; the parity
reader subtracts one block for a partial checkpoint and verifies coverage in
its own snapshot. Data parity can run before global live readiness.

```sh
env -i PATH=/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  LANG=C.UTF-8 TZ=UTC PGHOST=/var/run/postgresql PGPORT=5432 \
  PGDATABASE=yunipals_backfill PGPASSFILE=/dev/null \
  /opt/node-v24.18.1/bin/node \
  /opt/yunipals-unified/operations/free-replay-20261020/ownership-parity-peer-v2.mjs \
  --source unified --schema unified_shadow_20261020_7e7375b0 \
  --release-id 0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c \
  --baseline /opt/yunipals-unified/operations/fixed-boundary-20261020/legacy-baseline.json \
  --module-root /opt/yunipals-unified/releases/008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78/apps/yunipals-indexer/package.json \
  --postgres-peer
```

Root should open a fresh report descriptor with `O_EXCL`, mode0600, and direct
the command's stdout there; omit `--output`. This preserves root ownership
after the program drops to postgres, allowing the witness's protected-input
checks. The baseline must be readable by postgres and remain byte-identical
to SHA256 `69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540`.
Exit1 means capture failed,2 means data differs,3 means data matches with the
known legacy hash gap. Four absent historical hashes must remain absent.

After matching data **and** fresh official source readiness, reuse the existing
`fixed-boundary-witness.mjs` (SHA256
`90d2728c39d943666aa4b3e0d1870b98154f3e598fbadc040c9b939795f0ae0d`).
Copy the previously accepted plan into a fresh protected plan; supply the
candidate report path/SHA256 and a fresh output path. Retain the existing008
source, baseline and profile, and runtime inventory
`/var/tmp/yunipals-runtime-008028af-20261020/runtime-supplement.inventory.json`.
From the installed008 indexer directory run Node24 with `--import tsx`, the
existing helper and `--plan NEW_PLAN`; inspect its review, then run that exact
command once with `--apply REVIEW_HASH`. It uses21 free evidence RPC calls in
12 HTTP requests, no permits or paid fallback. Source6 remains compatible with
this evidence route. Do not repeat a witness-only capture, rebuild a release,
recapture the baseline or bypass the witness's built-in verification.

Fresh readiness is a separate gate: the productive native controller requires
zero support-role sessions, so starting a support observer during that run
would violate its guard. Existing source5 support operators also refuse the
new source6 proxy identities. Neither a first checkpoint movement nor matching
data alone authorizes consumer selection or a workaround for these gates.
The original allowance deadline and aggregate cap are unchanged.
