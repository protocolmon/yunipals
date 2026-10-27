# Booster artwork

The complete live YPAL catalog, `base-mainnet-standard-v1`, is generated,
reviewed and published: **264 cards**, comprising 11 species × six colors × two
horns × two finishes. There are 132 matte cards and 132 holographic cards. Every
holographic card includes foreground, background and star masks calibrated to
its exact pixels. All 264 public metadata responses and all 660 image/mask assets
passed verification on 27 October 2026.

An opening selects an existing variant image. It never starts image generation.
NFT-specific metadata adds the token's identity and birth information while
sharing that variant's artwork. The real three-day claim for original #1 minted
NFTs #4–6; all three images display in the verified live replay.

The collection, packs and wrapping share the one application at
[www.yunipals.com](https://www.yunipals.com). The fresh YPAL pack costs 1 YPAL per
original, supports up to ten originals per transaction, and earns one additional
mint every 24 hours after reveal. Older PROTO catalogs and local demo catalogs
are historical fixtures, not the live pack.

## Included files

- `catalogs/base-mainnet-standard-v1/manifest.json`: the original frozen recipe,
  references, trait dictionary and public origin. Its artwork commitment remains
  `0x29c9b8dfc3c35854a0396850a4e40da3457cf44a9901157c67564b92d61276ac`.
- `catalogs/base-mainnet-standard-v1/variants/0.json` through `263.json`: all
  approved public variant metadata.
- `catalogs/base-mainnet-standard-v1/complete-assets.json`: a separate inventory
  of every metadata hash, native source run and PNG/SVG asset. This inventory
  does not modify the frozen manifest.
- `assets/`: content-addressed native PNGs and SVG foil layers.
- `masks/`: exact-image silhouette and star calibration maps. Older approved
  cards also have authored maps in `scripts/boosters/artwork/`.
- `calibration/`: reviewed SAM prompt points, model hashes and calibration
  provenance for the new holographic cards. See its [notes](calibration/README.md).
- `../artwork-prototype/`: the native generation runs, exact prompts, source
  stages, official logo, locked style images and all 66 OG species/color
  references. `canonical.json` selects the actual published run for all 264
  variants. Native pixels are preserved rather than resized or repainted.

## Verify a checkout

Use Python 3.11 or later and the repository's Node.js version:

```sh
python3 -m venv /tmp/yunipals-booster-art-venv
/tmp/yunipals-booster-art-venv/bin/pip install -r scripts/boosters/requirements.txt
/tmp/yunipals-booster-art-venv/bin/python scripts/boosters/verify_art_catalog.py
```

The verifier runs offline. It checks the frozen generator and all references,
complete trait coverage, accepted native source runs, transparent card margins,
the inventory hashes, and every published PNG/SVG. It rebuilds publication in a
temporary directory and requires identical metadata and asset bytes. Expect
`variantCount: 264`, `matteCount: 132`, `holoCount: 132`, `assetCount: 660`.
CI runs the same check. No image API key or new image generation is required.

## Serve the included catalog

Copy the included public catalog and assets to a persistent runtime directory,
keeping pending jobs and locks outside Git:

```sh
install -d /srv/yunipals/booster-artwork/catalogs /srv/yunipals/booster-artwork/assets
cp -a docs/boosters/artwork-runtime/catalogs/base-mainnet-standard-v1 \
  /srv/yunipals/booster-artwork/catalogs/
cp -a docs/boosters/artwork-runtime/assets/. /srv/yunipals/booster-artwork/assets/
```

Configure the shared indexer API:

```sh
BOOSTER_ARTWORK_DIRECTORY=/srv/yunipals/booster-artwork
BOOSTER_ARTWORK_CATALOGS=base-mainnet-standard-v1
```

Follow the [single indexer setup](../../../apps/yunipals-indexer/README.md) for
database, ingestion and API startup. The API can mount the artwork directory
read-only. These files retain the live catalog's frozen public origin; a different
origin or recipe needs a new catalog for future pack types.

The existing API exposes these routes under its configured mount prefix:

- `GET /v1/boosters/art/:catalog/manifest.json`
- `GET /v1/boosters/art/:catalog/:variant.json`
- `GET /v1/boosters/art-assets/:sha.png`
- `GET /v1/boosters/art-assets/:sha.svg`

Ready metadata and fingerprint-checked assets are immutable. A missing variant
in a different catalog returns 202 with `Retry-After: 5`; it does not trigger an
image-generation request. The frontend distinguishes missing publication from
an image request failure and refreshes pending metadata.

Back up catalogs, assets, calibration maps and generation provenance. Use the
existing guarded publication helper for incremental production additions;
never replace a previously published variant.

## Prepare a future catalog

The current catalog is complete; these commands are for future artwork and
pack types. The frozen manifest commits to the recipe and references. First
publication of a variant is immutable. A changed recipe, reference or public
origin requires a new catalog.

```sh
python3 scripts/boosters/art_runtime.py \
  --directory /srv/yunipals/booster-artwork --catalog NEW_CATALOG \
  init --public-url https://YOUR_PUBLIC_API_PREFIX
```

Use `art_lab.py prepare` for each dictionary combination, then `art_lab.py next
--run RUN_ID` to obtain the exact prompt and ordered references. Generate through
Codex's built-in subscription image generation, accept the native output,
inspect the white/black/checkerboard previews, finalize and record visual
acceptance. Reuse existing accepted runs. Consult `art_lab.py --help` for the
controller's commands; never edit run manifests to skip review.

A new holographic card also needs an exact-image numeric SVG foreground path
and painted background star points, stored with the native PNG's SHA-256.
Inspect the silhouette and test the real interactive viewer at multiple angles
before registration. Multiple `M…Z` paths are treated as a union; a scanline
rectangle path preserves gaps and holes. Do not place stars on the monster.

```sh
python3 scripts/boosters/art_runtime.py \
  --directory /srv/yunipals/booster-artwork register-masks \
  --image /absolute/path/to/card.png --map /absolute/path/to/map.json
python3 scripts/boosters/art_runtime.py \
  --directory /srv/yunipals/booster-artwork --catalog NEW_CATALOG \
  publish --run RUN_ID
```

The reviewed production transfer helper supports prepublication before a reveal:

```sh
python3 ops/booster-launch/install-approved-artwork.py \
  --source /path/to/staged-publication \
  --catalog NEW_CATALOG --variant VARIANT_ID --allow-unrevealed
# Repeat with --apply only after the read-only review succeeds.
```

This retains frozen-manifest, trait, asset-hash, holo and immutable-publication
checks. It does not change contracts, mint NFTs or spend image API credits.

## Optional queue fallback

A confirmed-reveal queue remains available for other incomplete catalogs:

```sh
pnpm --filter @protopals/yunipals-indexer start:booster-artwork --once
python3 scripts/boosters/art_runtime.py --catalog NEW_CATALOG jobs
```

Only matching catalog commitments and numeric traits are admitted. Queue
processing prepares reproducible plans for operator-assisted generation; it is
not an unattended subscription endpoint. The complete live catalog does not
depend on this queue to supply artwork. The API and queue share persistent
storage; publication uses advisory locking and atomic writes. There is no
second user transaction to make already-approved artwork visible.
