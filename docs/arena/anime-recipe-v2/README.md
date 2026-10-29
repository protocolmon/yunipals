# Anime fighter recipe v2

This version adds three cosmetic signature kits, three per-fighter windup poses and
an owner-selected loadout of two. The existing nine poses, identity review and
subscription generation rules remain. The frozen lock commits to the style board,
all twelve species' three templates, element palettes and sheet prompts. Legacy
Uni and display Yuni names resolve to the same species library. Unknown species
need reviewed templates in a later recipe; they do not silently inherit a kit.

Generate and review the base poses before `kits TOKEN`. Review each kit and its
recorded grid, then fit, approve and export the complete fighter. Sprite `w`/`h`
remain image dimensions; `look.stageHeight["windup-<kit-id>"]` records the fitted
windup height on stage, just like the existing poses.

Species sheets live under `recipes/anime-fighter-v2/species/<species-slug>/`.
Projectile/strike filenames contain the kit id, role and content hash. Shared
per-element impacts use `species/elements-<element>/impact.<hash>.webp`. Every
manifest commits to each referenced file's full SHA-256 and exact cols/rows/blend.
The library is generated once and reviewed once; subsequent fighters reuse it.
After publication, a new sheet for an existing species requires a recipe change.

Projectiles and impacts are additive on pure black, with max-channel values below
22 floored to black. Strikes use luminance alpha `clamp((max-18)/40)` and the engine
restores the dark outline with four offset copies. Strike prompts require a thick
brush. The recorded grid is authoritative; it must divide the sheet dimensions.
Painted art replaces procedural projectiles/strikes for the selected kit. Missing
kits retain the deterministic procedural fallback. Existing music and synthesized
SFX are unchanged.

The curator can upgrade an Approved fighter only with a higher recipe version and
a new hash. Publication retains the original content-addressed manifest and assets,
so previously frozen films continue to resolve their committed v1 files. A loadout
changes presentation vocabulary only; it grants no combat effect.

Studio sequence (use a separate private lab for a v1-to-v2 upgrade):

```sh
python3 scripts/anime/studio.py --lab PRIVATE_LAB prepare TOKEN --recipe anime-fighter-v2
python3 scripts/anime/studio.py --lab PRIVATE_LAB generate TOKEN --stage 1
python3 scripts/anime/studio.py --lab PRIVATE_LAB review TOKEN idle
python3 scripts/anime/studio.py --lab PRIVATE_LAB generate TOKEN --stage 2
python3 scripts/anime/studio.py --lab PRIVATE_LAB key TOKEN
python3 scripts/anime/studio.py --lab PRIVATE_LAB fit TOKEN
python3 scripts/anime/studio.py --lab PRIVATE_LAB review TOKEN poses
python3 scripts/anime/studio.py --lab PRIVATE_LAB kits TOKEN
python3 scripts/anime/studio.py --lab PRIVATE_LAB review TOKEN approve-kit KIT_ID
# Repeat approve-kit for all three reviewed kits, then:
python3 scripts/anime/studio.py --lab PRIVATE_LAB review TOKEN approve
python3 scripts/anime/studio.py --lab PRIVATE_LAB export TOKEN
python3 scripts/anime/studio.py --lab PRIVATE_LAB publish --destination REVIEW_ASSET_ROOT
```

Before `review ... poses`, review the identity and clear `identityDraft` in the
private fighter record. `review TOKEN reroll KIT_ID.windup` archives that windup;
`review TOKEN reroll species:projectile` (or strike/impact) rerolls unpublished
shared sheets under the library lock. Published library art cannot be rerolled.
Approval batches carry their recipe version; v1 and v2 use separate batches.
The studio only emits unsigned approval calldata.
