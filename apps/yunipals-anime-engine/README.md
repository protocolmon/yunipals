# Yunipals anime engine

A production copy of the historical anime prototype, driven by reviewed fighter
manifests. Battle generation normalizes legacy `Uni` species/name prefixes to
`Yuni` (for example, `Uniturtle` → `Yuniturtle`, including compound species).
Source metadata, approved manifests, fighter IDs and verbatim strategies remain intact.
`src/director.ts` creates the base staging and whole-word quote suggestions from
the original referee events. Production Claude choreography supplies validated
movement paths, flight/depth/facing/rotation, body-attack visuals and cut-ins, as
in the manual workflow. It never rewrites combat events, damage or winners. The film is the authoritative published
artifact. `src/film.js` can also drive a live canvas player.

Use Node 24.22.1, Python with Pillow/numpy, ffmpeg, and the exact Chromium version in
`engine-lock.json`. Set `ANIME_CHROME` to the installed `chrome-headless-shell` binary.
Run `pnpm --filter @protopals/yunipals-anime-engine test` for director tests, twelve
manual-reference and twelve automated-choreography frame hashes, duration and
cue-sheet checks. The fixtures retain the original
Cedar/Zephyr/Bastion/Elrond tournament and is explicitly not Base launch artwork.

Reference images are downloaded, not committed to Git. The test command restores
the fixed artwork bundle from `assets-anime.yunipals.com` and checks the archive
and every image against `fixtures/assets-manifest.json`. Subsequent runs verify
the local cache without downloading. No image-generation API is called. The
sprite, recipe, engine and golden-frame hashes remain unchanged.

Before running the studio, release preflight, UI/media smoke checks or the golden
scripts directly, restore the ignored reference files from the repository root:

```sh
python3 scripts/anime/fetch-assets.py
# An already downloaded bundle also works offline:
python3 scripts/anime/fetch-assets.py --archive /path/to/anime-reference-assets.tar.gz
# Verify the cache without network access:
python3 scripts/anime/fetch-assets.py --check
```

The bundle includes the historical fighter poses/effects, the engine comparison
image and the two frozen recipe boards. Live fighter artwork remains in the
existing asset service; website teaser images and the engine background remain
ordinary runtime assets. Do not force-add downloaded reference images to Git.

The market API prepares a private job with `assets/{tournament,choreography,fighters,
sprites}.json`, verified WebP files and fonts. `node render.mjs JOB` renders silent
1280×720 H.264 at 30 fps and three poster frames. `mix.py` synthesizes deterministic
SFX and mixes the repository's credited CC-BY music; passing `-` as its music argument
produces SFX only. The market worker assembles and verifies the existing publication
allowlist and uses the existing canonical input/result and payout-release fences.

For a Chromium or engine update, increment the engine version, regenerate its file
lock, run `golden.mjs --update`, inspect sampled frames and the cue sheet, then run the
normal tests. Updating changed goldens under the same engine version is refused.
Keep old engine/recipe bundles for old fighters and jobs. Font licenses are included;
music attribution is copied into every published film package.
