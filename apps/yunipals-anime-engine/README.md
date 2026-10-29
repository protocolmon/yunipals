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
