# Booster artwork

One image per variant, shared by every monster with that variant. Generate and review the full 264-variant catalog in Codex before relying on immediate artwork for every opening. All 66 exact OG species/color references are registered. The recipe uses the complete OG character palette, official logo and approved lavender/crisp-body style. Public metadata never starts image generation. The confirmed-reveal queue remains a fallback for missing artwork.

The frozen catalog commits to the trait catalog, generator source, approved style references, logo and 66 OG image hashes. It commits to a recipe and its references, **not** to 264 images that do not exist yet. The first approved publication of each variant is immutable. Changed recipes/references or origins require a new catalog for future pack types. Contract upgrades remain possible as requested.

`base-standard-v1-demo` is the current loopback-only integration catalog; `base-standard-v1` is an archived earlier local catalog. Eight approved variants are published: 80, 81, 82, 83, 120, 149, 206, 259. Four holo variants have exact-image foreground/background/star masks. Metadata and PNG/SVG assets use content hashes. The foreground remains at the original pixel position; the light layers are masked to the background so they cannot wash out the monster.

## Setup

Use Python 3.11 or later and the repository's Node.js version. Install the
image-processing dependency in an isolated environment:

```sh
python3 -m venv /tmp/yunipals-booster-art-venv
/tmp/yunipals-booster-art-venv/bin/pip install -r scripts/boosters/requirements.txt
```

The exact OG references, approved style references and card calibrations are
included in this repository. The publisher loads authored calibration modules
from `scripts/boosters/artwork`; it does not require the old artwork review site.
Keep API credentials and pending jobs outside source control.

## Live application

The production collection and packs share **https://www.yunipals.com**. The Base
catalog is `base-mainnet-smoke-v1`; the separate unlimited public pack is type 2.
See [the accepted main-site release](../mainnet-launch/canonical-www-production-2026-10-22.json).
Variant 73 was revealed and published through a genuine mainnet opening. New
variant generation still requires an operator to generate and approve images;
the durable queue alone is not an unattended image-generation service.

## Local demo

Build contracts and start Anvil and the local harness as described in `../../boosters-implementation.md`. The harness uses the real 264-variant catalog and the local artwork service. It writes public addresses to `/tmp/yunipals-boosters-local.json`. The browser test deliberately chooses a mock seed for the approved green turtle; mainnet randomness is never controlled.

## Service configuration

Set these on the indexer API and queue worker:

```sh
BOOSTER_ARTWORK_DIRECTORY=/srv/yunipals/booster-artwork
BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1
BOOSTER_DATABASE_SCHEMA=yunipals_boosters_v1
```

Use the same persistent filesystem for API, worker and the Codex publisher. Mount it read-only in the API if possible; the queue worker writes only jobs. This prototype supports one publisher with advisory locking and atomic writes, and concurrent deduplicated enqueue operations on a filesystem that supports hardlinks. It is not a distributed object-storage queue. Back up manifests, metadata, masks, assets and lab references/run provenance before enabling sales. Keep jobs outside Git.

```sh
pnpm --filter @protopals/yunipals-indexer start:booster-artwork
# One scan:
pnpm --filter @protopals/yunipals-indexer start:booster-artwork --once
```

Only catalogHash + metadataBaseURI matches are scanned, and indexed numeric traits must match the variant rank. Reorgs cannot create NFTs through this queue; an already-generated valid variant can remain cached after a reveal is rolled back. No marketplace, score or arena records are added.

The existing API serves:

- `GET /v1/boosters/art/:catalog/manifest.json`
- `GET /v1/boosters/art/:catalog/:variant.json` — 200 immutable when ready; 202/no-store with `Retry-After: 5` while missing, queued, prepared or blocked.
- `GET /v1/boosters/art-assets/:sha.png` and `:sha.svg` — immutable, fingerprints checked before serving.

The collection and detail pages poll pending metadata; images are lazy-loaded in collection grids. The detail viewer supports pointer/touch, keyboard arrows/Home, reset, auto tilt, live holo toggle and reduced motion. Metadata without calibrated masks shows the static card rather than applying a whole-body foil layer.

## Initialize a public catalog

Use the actual HTTPS API prefix, including `/yunipals-indexer` if the service is mounted there. The loopback catalog cannot be reused on mainnet.

```sh
python3 scripts/boosters/art_runtime.py \
  --directory /srv/yunipals/booster-artwork --catalog base-mainnet-smoke-v1 \
  init --public-url https://api.yunipals.com/yunipals-indexer
```

This example is a deployment target, not a claim that this route is live. Configure the API mount, volume and CORS first. Serve the resulting manifest and verify its commitment before activating a pack with those URLs. Publish accepted sample runs into the same catalog using the command below; pixels/masks can be reused but the public origin is catalog-specific.

## Subscription-assisted queue processing

For full-catalog preparation, enumerate the 11 types, six colors, two horns and
two glitter finishes in `contracts/boosters/config/base-standard-v1.traits.json`.
Use `art_lab.py prepare` for each combination, then generate its exact `nextStage`
through Codex, accept it, inspect its light/dark/checkerboard previews, and record
visual approval. Reuse completed accepted runs. Every glitter image also needs
calibrated foreground/background/star masks and a viewer check before publication.

After the existing local publisher produces the reviewed assets and metadata,
the production transfer helper can explicitly prepublish a frozen variant:

```sh
python3 ops/booster-launch/install-approved-artwork.py \
  --source /path/to/staged-publication \
  --catalog base-mainnet-standard-v1 --variant VARIANT_ID --allow-unrevealed
# Repeat with --apply after the read-only review succeeds.
```

`--allow-unrevealed` removes the need to wait for an observed reveal job. It keeps
the frozen manifest, exact trait validation, asset hashes, holo requirements and
immutable-publication checks. An existing queue job must still match. Without
this flag, the helper continues to require an observed queued/prepared variant.
It does not change contracts, mint NFTs or spend image API credits.

```sh
python3 scripts/boosters/art_runtime.py --catalog base-standard-v1-demo jobs
python3 scripts/boosters/art_lab.py next --run RUN_ID
```

`jobs` prepares reproducible run plans for missing variants, validates the frozen source/reference commitment and records the run ID. The next-stage output contains the exact prompt and ordered local image references. In Codex, inspect the references and use built-in image generation through the `protopals-art`/`imagegen` workflow. This is an operator-assisted queue; there is no unattended subscription endpoint. No API key is read or used. A future API executor can consume the same next-stage contract.

Accept the generated output, perform the controller's existing alpha/canvas checks and inspect light, dark and checkerboard previews. Mark its visual review and explicit approval using `art_lab.py` before publication. The publisher refuses pending/rejected candidates and refuses replacing an existing variant. Keep the approved source run and image path in provenance. Consult `art_lab.py --help` for the accept/finalize/review commands; they require genuine native PNG output, not a screenshot or thumbnail.

For a new holo, calibrate a JSON map in native 1024×1536 card coordinates:

```json
{
  "sha256": "EXACT_PNG_SHA256",
  "foreground": "M400 300 C300 400 300 900 500 1200 L800 1200 Z",
  "stars": [
    [120, 350, 16],
    [850, 520, 12]
  ]
}
```

The example silhouette is illustrative; trace the actual monster and use its painted background stars. Multiple `M…Z` paths are treated as a union. Do not place star points on the face/body. Validate with the interactive viewer at several tilt angles before publishing. Registering a changed map for the same pixels is refused.

```sh
python3 scripts/boosters/art_runtime.py register-masks \
  --image /absolute/path/to/card.png --map /absolute/path/to/map.json
python3 scripts/boosters/art_runtime.py --catalog base-standard-v1-demo \
  publish --run RUN_ID
```

Pass the production `--directory` and `--catalog` for a production publication. Native images, metadata and masks are copied to immutable content-addressed files; new metadata is visible on the frontend's next five-second poll. There is no onchain metadata rewrite or second user transaction. Generic historical color references remain archived but are not used for new generation.
