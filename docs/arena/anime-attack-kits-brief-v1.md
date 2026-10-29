# Brief: signature attack kits for the anime arena

Written 2026-10-29 for the implementing agent on `codex/anime-arena`. Context and
design rationale: `anime-arena-plan-v1.md` section 7.5. Working prototype (reference
only, not to be copied verbatim): the ignored `.arena-lab/anime-v1/` directory and the
comparison page `http://91.98.159.219/arena-anime-975ca04bbfba/v3-attacks/`.

## Goal

Replace the code-drawn attack FX with painted, per-fighter **signature attack kits**
generated once at sponsorship time, add the free engine timing that goes with them,
and let the owner pick a loadout of 2 of 3 kits that the referee sees as cosmetic
vocabulary. Per-battle inference cost must not rise beyond the existing director call.

## Hard constraints

- Frozen combat data never changes: attack/defense timing, outcomes, damage, HP,
  winners. Kits are presentation only.
- No new per-battle provider calls. The only inference change is a `kit` field in the
  existing Opus director response and a few hundred extra tokens in the referee input.
- Scope update from the user (2026-10-29): the feature is not live. Launch with
  fresh recipe-v2 fighters and remove obsolete v1 admission; do not implement an
  Approved-to-Approved registry upgrade or a v1 migration. Keep historical
  prototype assets only as visual regression references.
- Code-drawn attacks stay as the fallback for any fighter, kind or event without a kit.
- Engine output stays deterministic. Hit stop and the camera punch change the timing
  of every film, so bump the engine minor version and regenerate both golden-frame sets
  deliberately, in their own commit, with the before/after frames attached to the
  release review.

## Reference material from the prototype

| What | Where |
| --- | --- |
| Kit loading, sheet slicing (`sheetFrame`, `cols`/`rows`), windup pose, projectile and strike sheet drawing, impact sheet, smear frames, hit-stop freezes, camera punch | `.arena-lab/anime-v1/render/site/film.js` (search `FX`, `sheetFrame`, `hitstop`, `smear`, `punch`) |
| Kit config shape | `.arena-lab/anime-v1/render/site/assets/kits.json` |
| Sheet keying: luminance key for opaque strikes, black floor for additive sheets | `.arena-lab/anime-v1/render/key.py` (`-sheet` branch) |
| The six prompts that produced the kit art | `.arena-lab/anime-v1/gen/{cedar,zephyr}-windup.prompt.txt`, `*-sheet.prompt.txt` |
| Visual result to match | `/v3-attacks/` comparison page; the "after" video is the acceptance reference for Cedar and Zephyr |

Lessons that must be encoded, not rediscovered:

1. Painted FX replace the procedural glow/trail/star for that event. Stacking both
   overexposes projectiles into a white blob.
2. Projectile and impact sheets are painted on pure black and composited with
   `globalCompositeOperation = "lighter"`. No chroma key. Floor near-black pixels
   (max channel < 22) to zero so haze adds nothing.
3. Strike sheets (whip, slash) are opaque objects: alpha from luminance
   (`clamp((max − 18) / 40)`), and the engine draws a dark halo (four offset copies at
   `brightness(0.25)`) under the frame to restore the outline the key removes.
4. State the grid shape in the prompt and record `cols`/`rows` in the manifest. The
   model returned a 1×2 sheet for the vine when asked for 2×2.
5. Strike art needs a thick brush: a whip across the full panel reads thin at fighting
   distance. Put a minimum stroke width in the prompt.
6. Flip the projectile sheet horizontally when the shot travels right; sheets are
   painted flying left.

## Work items, in order

### 1. Manifest and core types (`packages/yunipals-market-core/src/anime.ts`)

Extend `AnimeManifest` (optional fields so v1 manifests still validate):

```ts
kits?: AnimeKit[];              // exactly 3 when present
defaultLoadout?: [string, string];
```

```ts
type AnimeKit = {
  id: string;                    // slug, unique within the manifest
  name: string;                  // ≤ 2 words, ≤ 24 chars (same limits as director attack names)
  kind: "projectile" | "strike" | "dash";
  element: string;               // palette key for impacts: nature, amber, water, void, …
  description: string;           // one line, ≤ 120 chars, cosmetic
  windup: AnimeSprite & { h: number };
  projectile?: AnimeSheet;       // kind projectile
  strike?: AnimeSheet;           // kind strike
  impact: AnimeSheet;
};
type AnimeSheet = { sheet: string; sha256: string; cols: number; rows: number; blend: "add" | "alpha" };
```

`sheet` paths are relative to the assets origin and point into the shared species
library (`recipes/anime-fighter-v2/species/<species>/…`), so several fighters reference
the same file. The manifest hash still commits to every sheet's sha256. Add validation
and tests next to the existing manifest checks.

### 2. Recipe v2 (`docs/arena/anime-recipe-v2/`)

- Copy v1, bump `id`/`version`, new `recipe-lock.json`.
- `style.json` gains:
  - `kits.species[<species>]`: three kit templates each (`name`, `kind`, `element`,
    `description`, `windupPrompt`). Example for Unibranch: Vine Lash (strike, nature),
    Thorn Volley (projectile, nature), Root Slam (dash, nature).
  - `kits.sheets`: prompt templates for projectile, strike and impact sheets with the
    black-background and grid-layout paragraphs from the prototype prompts, plus the
    minimum stroke width for strikes.
  - `kits.elements`: palette per element for recolouring.
- README: the per-species library is generated once and reviewed once; fighters reuse
  it. A new sheet for an existing species is a recipe change.

### 3. Studio (`scripts/anime/studio.py`)

- New stage 3 command `kits <tokenId>`: writes the three kit drafts from the species
  template and identity text into the stage contract; generates the three windup poses
  with the approved idle and attack pose as references (chroma key, same retry rules);
  generates any missing species sheets into the library folder; keys them with the
  sheet rules above; writes a contact sheet.
- `fit` sets each windup's stage height from alpha bounds like the other poses.
- `review` accepts `approve-kit <id>`, `reroll <kit>.windup`, `reroll species:<kind>`.
- `export` writes `kits` and `defaultLoadout` (first two kits) into the manifest and
  copies the referenced library sheets into the publication allowlist.
- `publish` ships the species library directory alongside fighters.
- Tests in `studio_test.py` for the manifest output and the keying functions.

### 4. Engine (`apps/yunipals-anime-engine/src/film.js`)

- Load kits from the fighter manifests (verify sheet sha256 like sprites). Register
  the windup pose per kit under `LOOK[id].h` and `LOOK[id].face`.
- Event → kit resolution happens in the director output (item 5); the engine reads
  `e.kit` and draws:
  - windup pose during `[start, release)` with the lean-back, then the release pose;
  - projectile sheet frames (`Math.floor(f * 14) % 4`, additive, flip by direction)
    instead of the procedural star/orb; keep a dim trail only;
  - strike sheet revealed from the origin along the strike line with a clip rect,
    frame 0 while extending, the glowing frame at contact, outline halo, instead of the
    bezier vine;
  - impact sheet for 0.3 s at contact (4 frames, additive, random rotation seeded by
    the event index) on top of the ring and sparks;
  - dash kits keep the existing dash staging and use only windup + impact.
- Timing features (independent of kits, apply to every film): hit-stop freezes of
  0.14 s on `hit` and 0.08 s on `guarded` (not on the KO, which has its own hold);
  callouts stay visible during the hold; two-frame smear of the release pose
  (`scale(1.45, 0.96)` from a point 40 px behind the body, alpha 0.45); camera punch
  `zoom *= 1 + 0.07 * (1 − age/0.25)²` for 0.25 s after each release, applied in film
  time after the camera smoothing.
- Engine version 1.1.0, `engine-lock.json` updated, both golden-frame sets regenerated.
- Fixture: add Cedar and Zephyr kits to the manual-reference fixture so the automated
  path has kit coverage; compare against the `/v3-attacks/` after-video.

### 5. Director and validator (`apps/yunipals-anime-engine/src/director.ts`, `apps/yunipals-market-api/src/arena/live/animeDirection.ts`)

- Input: per fighter, the loadout kits (`id`, `name`, `kind`, `description`).
- Output: `attacks[].kit` (kit id or null). Prompt rule: choose the loadout kit whose
  name or description matches the recorded `attackName`/`visibleAction`; a body-contact
  event may use a `dash` kit; a ranged event may not.
- Validator: `kit` ∈ that fighter's loadout; `kit.kind` compatible with the event's
  allowed kinds; otherwise reject the response like any other structural failure.
- Deterministic fallback used when a kit is null or the director is unavailable:
  exact name match in `attackName` → first loadout kit of the event's kind → no kit
  (code-drawn `look.attackKind`).
- `director.test.ts`: coverage for match, fallback and rejection.

### 6. Loadout in submission and referee input (market API)

- `StrategySubmission.loadout?: [string, string]` (`intake.ts`). Validate against the
  fighter's manifest kits at submission time; default to `defaultLoadout`. Store it in a
  new plaintext column on `submission` (it is not secret and not part of the strategy
  commitment); include it in the disclosure payload.
- `input.ts` `compileLiveInput`: add `roster[].techniques` = the two chosen kits'
  `name` + `description`, and `strategies[].loadout`. Because this changes the frozen
  input shape, update the anime rules manifest (not yet deployed) and the referee
  system prompt with one sentence: "Known techniques are cosmetic names for the
  fighter's usual attacks; they grant no damage, energy, timing or defensive effect."
- Tests: submission validation, default loadout, input hash stability for v1 fighters
  without kits (field omitted, not `null`).

### 7. Website (`apps/yunipals-home-web`)

- Fighter card: the three kits with name, element and a small canvas preview that
  plays the projectile/impact sheet frames.
- Strategy form: loadout picker, 2 of 3, default pre-selected, sent with the
  submission. Keyboard accessible, `aria-pressed` on the kit buttons.
- Rules page: one paragraph on loadouts being cosmetic.

## Acceptance

- Re-rendered manual-reference tournament with Cedar/Zephyr kits looks at least as
  good as the `/v3-attacks/` after-video; Bastion/Elrond (no kits) render unchanged
  apart from the timing features.
- `node scripts/anime/preflight.mjs` passes; both golden sets regenerated once, with
  the engine version bump in the same change.
- A rehearsal through the production director path returns valid `kit` ids and costs
  within the existing choreography bound.
- Studio can produce a complete v2 fighter (9 poses + 3 windups + library sheets)
  for one Base token end to end, with the manifest validating and publishing.
- No change to any frozen outcome, HP or winner in the fixtures.

## Out of scope for this brief

Per-attack video clips, character rigging, new hurt/down poses, and the onchain
loadout. Those stay as later options.
