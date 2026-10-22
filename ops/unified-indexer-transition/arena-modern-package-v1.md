# Offline modern Arena package

This operator prepares one unselected consumer artifact. It never deploys it,
changes a source selector, starts workers, migrates a database, installs packages,
loads credentials or calls a provider. Previous attempts and artifacts remain
unchanged. Its implementation reuses the checksum-pinned credential-v2 renderer,
source6 source/archive primitives and runtime-supplement verifier. The disk guard,
child supervision and runtime argument methods retain the credential-v2 bodies.

The accepted dependency baseline is source `3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d`,
manifest `1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8`,
with 1,746 source files, 330 dependency packages and 60,918 runtime paths.
The modern source is an externally pinned complete overlay, not a hardcoded
three-file patch. The current 1,293-file overlay composes to 1,796 source files,
source digest `264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24`
and manifest `fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e`.
It includes all eight independent acceptance files so relocated tests are reproducible.

## Fixed preparation inputs

Use only the new root-owned operation directory
`/opt/yunipals-unified/operations/arena-modern-package-20261022` and a fresh empty
0700 work directory `/mnt/HC_Volume_107222036/arena-modern-package-20261022`.
Create no replacements for existing files or attempts. Stage these public inputs
under their fixed operation-directory names:

| Name | SHA-256 or authority |
| --- | --- |
| `arena-modern-package-v1.py` | Exact independently reviewed operator bytes |
| `arena-credential-package-v2.py` | `b5022fdd7a3b1b29d57681f872f7c014f70a21e165440d6ea37d221b6e8e0ff3` |
| `source6-package-v3.py` | `76cca2956355de69f6e6e2d60af3ea8f7de2a4bb34807b6dbc06aebc84ef3551` |
| `runtime-supplement.py` | `49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4` |
| `proposal.v1.json` | `6cb914372d5863616dcde8f753bc97380916e86073556999eaf082cf8fc6e39e` |
| `base-source.tar.gz` | `af09ea5b6f557f582e5203dbca38eed6641280bc5b5f49ee180a76b528a7aa2f` |
| `base-consumer-evidence.json` | `50491f6ddd840a65cbd07d45eeb2923edd88eb62647a8cce5587050d6077b000` |
| `overlay-manifest.json` | Current external manifest `a7ec13c29a7af5f37390fffabd27ce7c1b9aa8f8bb1b254f8fafe32123b13393` |
| `overlay.tar.gz` | Current public archive `4975231a4a19ebbb32490a255e1e9f532f3593cb422b5fed1371922829d2505b` |

The baseline source tree remains at `/opt/yunipals-unified/releases/<base digest>`.
Its accepted runtime archive/inventory remain read-only at
`/var/tmp/yunipals-runtime-3c8776b9-20261021`; they are read directly rather than
transferred to an executor. The operator checks their original independent pins,
completed baseline build proof, all source hashes, runtime/platform identity and
Node 24.18.1 checksum before review succeeds.

The overlay archive must contain exactly its manifest-listed regular files plus
`arena-live-compat-overlay-manifest.json`, whose bytes equal the separately
pinned manifest. Duplicate names, traversal, links, extra members, changed
lengths/hashes, missing acceptance files, new dependencies or changed Ponder
writer/lock inputs refuse. Only the four known content-addressed identity `.img`
references and the exact public soundtrack `.mp3` are allowed binary source
resources; arbitrary media and all island PNGs remain forbidden.

## Plan, review and one attempt

Import the reviewed operator without invoking `main`, then create a root-only
`plan.json` with exclusive creation. Its exact seven fields are:

```python
plan = {
    "format": module.FORMAT,
    "operatorSha256": module.sha(operator_bytes),
    "work": str(module.WORK),
    "baseSourceDigest": module.BASE_DIGEST,
    "overlayManifestSha256": "a7ec13c29a7af5f37390fffabd27ce7c1b9aa8f8bb1b254f8fafe32123b13393",
    "overlayArchiveSha256": "4975231a4a19ebbb32490a255e1e9f532f3593cb422b5fed1371922829d2505b",
    "hiddenVolumeChildren": module.hidden_children()
}
```

Render `module.unit_text("review", plan)` and `module.unit_text("build", plan)`.
The names are `yunipals-arena-modern-package-v1-review-20261022.service` and
`yunipals-arena-modern-package-v1-build-20261022.service`. Install only these new
transient definitions; preserve all previous units. Keep owner-created output
capture outside the empty work directory, using the existing bounded output
capture pattern. The exact review command is:

```text
/usr/bin/python3 -B /opt/yunipals-unified/operations/arena-modern-package-20261022/arena-modern-package-v1.py --plan /opt/yunipals-unified/operations/arena-modern-package-20261022/plan.json
```

Accept its actual review hash before replacing the single `REVIEW_HASH` token in
the generated build definition. The build command adds `--build <actual hash>`.
It repeats the complete review and rejects any difference. Start once without
blocking a terminal for the entire build; observe in short bounded calls.

Both units have private networking, AF_UNIX only, no environment files or
credentials, no capabilities, `NoNewPrivileges`, strict filesystem protection,
and only the new work directory writable. Private configuration, PostgreSQL data
and sockets, backups and unrelated volume children are inaccessible. Bounds are
2 GiB/no swap, one CPU, 50 MiB/s I/O, a 35-minute outer unit limit and 30-minute
helper deadline. The existing protected volume lease is held. Startup requires
25 GB reserve plus a 3 GB allocation allowance; the ongoing inherited monitor
refuses when the actual reserve or measured allocation cap is breached.

`BUILD-ATTEMPT.json` and all outputs use exclusive creation. A terminal failure
retains its partial work and compact result. No automatic retry or work reuse is
supported. Reconciliation of an interrupted attempt is a separate owner action.

## Required actual proof

The operator creates vetted, non-symlink parents for the added source/resources
before using the unchanged patch helper. It captures the source archive twice
and requires byte equality. Every source byte and `SHA256SUMS` entry is verified
by the pinned `runtime-supplement.source_check` in both trees. The older Node
`prepare-release --verify` deliberately rejects `.img`/`.mp3`; this operator does
not claim that older verifier passed for the five newly included public files.

The first tree runs full indexer/API typechecks, exactly 79 actual credential
controls, exactly 21 independent modern protocol/HTTP controls, the ordinary API
build and the complete 898-island/four-profile catalog smoke. Test commands must
produce nonempty exact passing summaries; exit zero alone is insufficient.
Catalog rules must equal `0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80`
and pool hash `0x9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c`.
The old smoke emits the pool digest without `0x`; its exact raw digest is checked
before normalizing the public proof to the prefixed hash.

The complete reviewed 1,796-file source builds a full consumer artifact. All
original runtime paths remain present; dependencies, shims, metadata, modes,
links and every non-bundle byte remain exact. Only the known 36 bundles and their
maps may change. Each changed bundle must contain an actual changed frozen source
in its fully verified sourcePaths closure; changing build configuration alone
never qualifies it. The proof lists Arena and other qualified changed bundles
separately, with each bundle's changed source paths. The candidate proxy remains
unselected and is not approved for source, replay or proxy activation. Exactly
`arena-monitor.mjs`, `arena-monitor.mjs.map`, `arena-recovery.mjs` and
`arena-recovery.mjs.map` add paths, giving 60,922 runtime entries and 36 bundles.
All 36 source maps must bind full source contents to the candidate manifest;
compiled tests or unlisted sources refuse.

An independent relocated source tree receives the captured runtime exclusively.
It repeats 79 credential controls, 21 acceptance controls, the ordinary build and
catalog smoke, then produces byte-identical runtime archive and inventory.
There are no package-manager installs, downloads, database connections, provider
calls, Ponder builds or service deployments. Indexer application inputs remain
unchanged; shared source may change transitively, so no full transitive writer
source equality is claimed. The active Ponder runtime is not changed.

The final proof is `WORK/arena-consumer-package-proof.json`. Its v2-compatible
fields include `sourceDigest`, `source.{manifestSha256,archiveSha256,files}`,
`runtime.{archiveSha256,inventorySha256,entries,separateRelocatedTreeRebuildByteIdentical}`
and `verification.{twoFullTypechecks,ordinaryMarketBuilds,bundleCount,dependencyPackages}`.
It additionally records two 79-control suites, two 21-control suites, exact
normalized catalog identity and externally pinned overlay identity. The complete
overlay stays in its independently pinned manifest; its count/digest in the
proof avoid duplicating 1,293 rows into the installer's small receipt.

The four actual test step names are `credential-reader-controls`,
`relocated-credential-reader-controls`, `modern-acceptance` and
`relocated-modern-acceptance`. The compact stdout includes `proofSha256` and
`reviewHash`; `attempt-result.json` binds actual child step exit statuses and
output hashes. Eight rendered disabled native-unit definitions are public build
outputs only, never installed or started by this operator.

## Separate retained-image qualification

The build proof always says `assetsQualified=false` and `mediaComplete=false`.
It embeds only four small public reference images and the soundtrack; the 898
island PNGs (about 1.85 GB) are not copied into three build trees or source archives.
The retained production image tree is
`/root/yunipals/docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public/images`.
Each image must match the unique frozen metadata token ID and its
`properties.image_sha256`, not merely a filename/count.

After an actual successful build, a separate owner-run read-only command is:

```text
/usr/bin/python3 -B /opt/yunipals-unified/operations/arena-modern-package-20261022/arena-modern-package-v1.py --plan /opt/yunipals-unified/operations/arena-modern-package-20261022/plan.json --qualify-assets <actual completed proof SHA256>
```

It verifies all 903 fixed published assets (898 PNGs, four reference images and
soundtrack), hashes them in place with per-file and whole-set identity checks,
and reports qualified root/count/bytes/inventory digest. It copies, downloads,
attaches and renders nothing. Even a successful byte qualification keeps
`mediaComplete=false`: a separately reviewed asset attachment and runtime
preflight remain required. This command runs outside the build's protected-home
namespace so it can read that exact public tree; it loads no private configuration.

Run local controls with:
`python3 -B ops/unified-indexer-transition/arena-modern-package-v1-test.py`.
The integration controls use the retained public overlay and baseline archives;
when those optional artifacts are absent they explicitly skip instead of claiming
artifact qualification. No actual production build or media enablement is implied
by the local controls.
