"""Subscription-assisted booster art: prepare, generate in Codex, accept, review, export.

The controller never reads API keys. Each nextStage describes one built-in image_gen
call; an API executor can consume the same stage contract in a later implementation.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LAB = ROOT / "docs/boosters/artwork-prototype"
DICTIONARY = ROOT / "contracts/boosters/config/base-standard-v1.traits.json"
RECIPE_VERSION = "og-booster-card-v5-species-palette"


def frame_design(style, color):
    colors = {"Yellow": "#e4bc40", "Green": "#399864", "Blue": "#1d4ed8",
              "Red": "#c83d4e", "Purple": "#8545b5", "Black": "#26303f"}
    if style not in ["brand", "monster"]:
        raise ValueError("Choose a brand or monster frame")
    return {"frameStyle": style, "label": "Brand lavender" if style == "brand" else f"NFT {color.lower()}",
            "frameColor": "#c7c9f9" if style == "brand" else colors[color],
            "brandColor": "#7e22ce", "headingFont": "Archivo Black",
            "decision": "comparison candidate; border policy not selected"}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
        file.write(json.dumps(value, indent=2) + "\n")
        temporary = Path(file.name)
    temporary.replace(path)


@contextmanager
def locked(lab):
    lab.mkdir(parents=True, exist_ok=True)
    with (lab / ".generation.lock").open("a") as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        yield


def relative(path, lab):
    return str(path.resolve().relative_to(lab.resolve()))


def asset(lab, name):
    path = (lab / name).resolve()
    if not path.is_relative_to(lab.resolve()) or not path.is_file():
        raise ValueError("Missing or invalid lab asset")
    return path


def snapshot(lab, name):
    path = asset(lab, name)
    return {"path": relative(path, lab), "sha256": digest(path.read_bytes())}


def register_reference(lab, monster_type, image, identity, source, legacy_type=None,
                       token_id=None, chain_id=None, contract=None):
    if monster_type not in [item["name"] for item in read_json(DICTIONARY)["types"]]:
        raise ValueError("Unknown monster type")
    with Image.open(image) as picture:
        if picture.format != "PNG" or min(picture.size) < 512:
            raise ValueError("Use an OG PNG reference at least 512 pixels on each side")
        picture.verify()
    if not identity.strip() or not source.strip():
        raise ValueError("Describe the OG identity and record its source")
    with locked(lab):
        name = f"references/{monster_type.lower()}-{digest(image.read_bytes())[:12]}.png"
        target = lab / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copyfile(image, target)
        registry_path = lab / "references.json"
        registry = read_json(registry_path) if registry_path.exists() else {"schemaVersion": 1, "logo": "references/yunipals-logo.png", "types": {}}
        registry["types"][monster_type] = {"image": name, "identity": identity,
            "source": source, "legacyType": legacy_type, "tokenId": token_id,
            "chainId": chain_id, "contract": contract}
        write_json(registry_path, registry)
    return {"registered": monster_type, "image": name, "sha256": digest(target.read_bytes())}


def variant_traits(monster_type, color, horn, glitter):
    dictionary = read_json(DICTIONARY)
    names = {"types": monster_type, "colors": color, "horns": horn, "glitters": glitter}
    indices = []
    ids = {}
    for category, name in names.items():
        values = dictionary[category]
        found = next((i for i, item in enumerate(values) if item["name"] == name), None)
        if found is None:
            raise ValueError(f"Unsupported {category}: {name}")
        indices.append(found)
        ids[category] = values[found]["id"]
    t, c, h, g = indices
    variant_id = (((t * len(dictionary["colors"]) + c) * len(dictionary["horns"]) + h)
                  * len(dictionary["glitters"]) + g)
    return {
        "type": monster_type, "color": color, "horn": horn, "glitter": glitter,
        "ids": ids, "variantId": variant_id,
        "key": f"{monster_type.lower()}-{color.lower()}-{horn.lower()}-glitter-{glitter.lower()}"
    }


def register_palette(lab, color, image, description, source, monster_type=None):
    if color not in [item["name"] for item in read_json(DICTIONARY)["colors"]]:
        raise ValueError("Unknown color")
    if monster_type and monster_type not in [item["name"] for item in read_json(DICTIONARY)["types"]]:
        raise ValueError("Unknown monster type")
    with Image.open(image) as picture:
        if picture.format != "PNG" or min(picture.size) < 512:
            raise ValueError("Use an actual OG PNG palette reference at least 512 pixels on each side")
        picture.verify()
    if not description.strip() or not source.strip():
        raise ValueError("Describe the actual OG tones and record their source")
    with locked(lab):
        name = f"references/palette-{color.lower()}-{digest(image.read_bytes())[:12]}.png"
        (lab / name).parent.mkdir(parents=True, exist_ok=True)
        if not (lab / name).exists():
            shutil.copyfile(image, lab / name)
        registry = read_json(lab / "references.json")
        key = f"{monster_type}:{color}" if monster_type else color
        registry.setdefault("palettes", {})[key] = {
            "color": color, "monsterType": monster_type, "image": name,
            "description": description, "source": source}
        write_json(lab / "references.json", registry)
    return registry["palettes"][key]


def palette_reference(registry, monster_type, color):
    palettes = registry.get("palettes", {})
    reference = palettes.get(f"{monster_type}:{color}")
    if not reference:
        raise ValueError(f"Register an actual {color} OG palette for {monster_type} before generating; both species and color must match")
    if reference["color"] != color or reference.get("monsterType") != monster_type:
        raise ValueError("OG palette species/color do not match the requested traits")
    return reference


def prompts(traits, identity, frame_style="brand"):
    design = frame_design(frame_style, traits["color"])
    horn = (
        "exactly one clearly visible warm HONEY-GOLD SPIRAL horn, naturally tapered "
        "with defined spiral grooves, golden-beige highlights and antique bronze shadows; "
        "match the normal golden spiral horn of OG Yunipals NFTs, rather than an ivory-white soft-serve shape"
        if traits["horn"] == "Spiral" else
        "exactly one clearly visible DIAMOND horn: an elongated faceted crystal spike, "
        "with crisp flat diamond-cut planes, an icy translucent ivory surface, and NO spiral ridges"
    )
    glitter = (
        "GLITTER = YES: the colored body contains clearly visible fine iridescent glitter "
        "microflakes, bright tiny silver-blue prismatic glints embedded in its surface. "
        "Keep the base body color dominant and its face readable."
        if traits["glitter"] == "Yes" else
        "GLITTER = NO: ordinary smooth painted body surfaces, without embedded glitter, "
        "sparkle particles, rainbow sheen or holographic effects."
    )
    creature = f"""Create a 1024 x 1024 PNG character reference by EDITING the attached OG Yunipals monster.
This exact character is the identity reference, not merely a style example.
IDENTITY TO PRESERVE: {identity}
Preserve its species, face, eye shape, silhouette, body proportions, limb count, tail,
ears, distinctive head structures and recognizable markings. Keep the original soft
painted 3D collectible rendering style. Do not invent a new species or evolve it.
TARGET TYPE: {traits['type']}. PRIMARY BODY COLOR: {traits['color']}.
Recolor its main body surfaces to this color; keep recognizable secondary markings
and natural eye colors. The primary color must be unmistakable.
FOREHEAD HORN: {horn}, naturally attached at the center of the forehead.
Replace the existing forehead horn with this requested horn. Preserve other anatomical
features of the OG reference; do not add extra unicorn horns.
{glitter}
Full body, open eyes, centered, friendly expression and the OG character's recognizable
stance. Use a clean soft neutral studio background and a small ground shadow.
Only one monster. No text, no logo, no card frame, no accessories, no extra characters.
"""
    card = f"""Create one finished 1024 x 1536 PNG YUNIPALS collectible card, portrait 2:3.
Reference image #1 is the EXACT {traits['type']} character to preserve.
Reference image #2 supplies ONLY the OG meadow background: green hills, blue sky,
soft clouds and the small distant windmill. Do not copy its original monster.
Reference image #3 is the YUNIPALS logo badge; preserve its recognizable design.
Seat the character from image #1 naturally in that cheerful painted-3D meadow.
Keep the same face, anatomy, body color, {traits['horn']} horn and
{'visible body glitter' if traits['glitter'] == 'Yes' else 'ordinary non-glitter body'}.
The creature is large and readable, its complete body, horn and tail inside the frame.
CARD DESIGN: a clean premium {design['label']} rounded frame, main frame color
{design['frameColor']}, with refined deep Yunipals grape-purple #7e22ce pinstripes.
Use the official website's lavender #c7c9f9, grape #7e22ce and subtle purple-to-cyan
accent palette. A pale frosted-glass header and matching bottom nameplate.
Use the supplied official logo exactly: its flat dark-outlined pale-gold dragon head,
green eye and mint fins on a hot-pink circular badge. Do not replace it with a 3D logo.
Place it at the left of the header. Exact header: YUNIPALS, bold Archivo Black-style
block sans-serif in grape #7e22ce. Use the same brand color for the monster name.
Exact bottom name: {traits['type'].upper()}. These are the only text elements.
No level badge, statistics, numbers, rarity symbols, ability text or invented labels.
This stage is a NON-HOLOGRAPHIC base card. Preserve requested glitter on the creature
when present, but do not add whole-card rainbow foil yet.
OUTPUT: one upright card with clean rounded corners on a FULLY TRANSPARENT exterior,
no surrounding canvas color, no exterior glow, no drop shadow, no halo. The card fills
most of the image with a small equal transparent margin and an intact outer border in the selected frame color.
"""
    foil = f"""Edit this exact finished 1024 x 1536 YUNIPALS card to add a holographic finish.
Keep the SAME {traits['type']} identity, {traits['color']} color, {traits['horn']} horn,
pose, meadow scene, framing, logo, typography and card dimensions.
GLITTER = YES has TWO visible properties: the monster's body has fine embedded glitter,
and the card art has a luxurious prismatic holographic foil overlay. Preserve and make
readable the body glitter. Add tasteful rainbow refraction, fine diagonal holographic
sheen and small sparkling glints over the art, while keeping the original body color
and face recognizable. Preserve the selected frame color, official logo and grape-purple
brand typography, crisp and unobscured.
Exact header YUNIPALS, exact bottom name {traits['type'].upper()}; no extra text.
Preserve the transparent exterior and clean rounded silhouette. No exterior halo,
no shadow or opaque background. Output one 1024 x 1536 PNG with transparency.
"""
    return {"creature": creature, "card": card, "foil": foil}


def prepare(lab, monster_type, color, horn, glitter, new_candidate=False, frame_style="brand"):
    if (lab / "references.json").exists() and read_json(lab / "references.json").get("designLock"):
        return prepare_locked_card(lab, monster_type, color, horn, glitter, new_candidate, frame_style)
    traits = variant_traits(monster_type, color, horn, glitter)
    with locked(lab):
        registry = read_json(lab / "references.json")
        check_frame_selection(registry, frame_style)
        canonical_path = lab / "canonical.json"
        if canonical_path.exists() and not new_candidate:
            canonical_run = read_json(canonical_path).get(traits["key"])
            if canonical_run:
                return next_stage(lab, canonical_run)
        reference = registry["types"].get(monster_type)
        if not reference:
            raise ValueError(f"Register an OG reference for {monster_type} before generating it")
        refs = {"og": snapshot(lab, reference["image"]), "logo": snapshot(lab, registry["logo"])}
        if not new_candidate:
            ready = [read_json(path) for path in sorted((lab / "runs").glob("*/run.json"))]
            ready = [run for run in ready if run["traits"]["key"] == traits["key"]
                     and run["recipeVersion"] == RECIPE_VERSION
                     and run.get("design", {}).get("frameStyle") == frame_style
                     and run["references"]["logo"] == refs["logo"]
                     and run["references"]["og"] == refs["og"]
                     and run["review"]["decision"] != "rejected"
                     and all(stage in run["stages"] for stage in run["stageOrder"])]
            if ready:
                return next_stage(lab, max(ready, key=lambda run: run["createdAt"])["id"])
        text = prompts(traits, reference["identity"], frame_style)
        fingerprint = digest(json.dumps({"recipe": RECIPE_VERSION, "traits": traits,
            "references": refs, "prompts": text}, sort_keys=True).encode())
        existing = sorted((lab / "runs").glob("*/run.json")) if (lab / "runs").exists() else []
        matches = [read_json(path) for path in existing if read_json(path)["fingerprint"] == fingerprint]
        if matches and not new_candidate:
            selected = next((run for run in matches if run["review"]["decision"] == "accepted"), matches[-1])
            return next_stage(lab, selected["id"])
        attempt = len(matches) + 1
        run_id = f"{traits['key']}-{fingerprint[:10]}-a{attempt:02}"
        directory = lab / "runs" / run_id
        stages = ["creature", "card"] + (["foil"] if glitter == "Yes" else [])
        run = {"schemaVersion": 1, "id": run_id, "recipeVersion": RECIPE_VERSION,
            "fingerprint": fingerprint, "attempt": attempt, "createdAt": now(),
            "executionMode": "codex-subscription-assisted", "traits": traits,
            "design": frame_design(frame_style, color),
            "references": refs, "referenceProvenance": reference,
            "backgroundModifier": "meadow-blue: preserve rolling green hills, a clear azure sky, soft clouds and the distant windmill",
            "stageOrder": stages, "prompts": {key: text[key] for key in stages},
            "stages": {}, "review": {"decision": "pending", "note": ""}}
        directory.mkdir(parents=True, exist_ok=False)
        for stage in stages:
            (directory / f"{stage}.prompt.txt").write_text(text[stage])
        write_json(directory / "run.json", run)
    return next_stage(lab, run_id)


def lock_design(lab, classic_run, glitter_run):
    with locked(lab):
        styles = {}
        for finish, run_id in [("No", classic_run), ("Yes", glitter_run)]:
            run = read_json(run_path(lab, run_id))
            if (not next_stage(lab, run_id)["complete"] or run["review"]["decision"] != "accepted"
                    or run["traits"]["glitter"] != finish):
                raise ValueError("Lock complete, accepted classic and glitter style references")
            styles[finish] = {"runId": run_id, **snapshot(lab, run["stages"][run["stageOrder"][-1]]["path"])}
        registry = read_json(lab / "references.json")
        existing = registry.get("designLock")
        if existing and existing["styles"] != styles:
            raise ValueError("The design is already locked to different reference artwork")
        lock = existing or {"id": "lavender-crisp-v1", "selectedBy": "user", "selectedAt": now(),
            "styles": styles, "rules": ["Official logo and lavender/grape frame", "Crisp dimensional monster, clean face and contours",
                "Sparse body glints only for glitter variants", "Holographic finish concentrated in the background",
                "Golden spiral or faceted diamond forehead horn", "Blend viewer finish with calibrated subject and star masks"]}
        registry["designLock"] = lock
        write_json(lab / "references.json", registry)
        write_json(lab / "design-lock.json", lock)
    return lock


def prepare_locked_card(lab, monster_type, color, horn, glitter, new_candidate=False, frame_style="brand"):
    traits = variant_traits(monster_type, color, horn, glitter)
    with locked(lab):
        registry = read_json(lab / "references.json")
        check_frame_selection(registry, frame_style)
        canonical = read_json(lab / "canonical.json") if (lab / "canonical.json").exists() else {}
        if traits["key"] in canonical and not new_candidate:
            return next_stage(lab, canonical[traits["key"]])
        style = registry["designLock"]["styles"][glitter]
        refs = {"style": snapshot(lab, style["path"]),
                "logo": snapshot(lab, registry["logo"])}
        if refs["style"]["sha256"] != style["sha256"]:
            raise ValueError("The locked style reference changed on disk")
        palette = palette_reference(registry, monster_type, color)
        refs["palette"] = snapshot(lab, palette["image"])
        refs["og"] = refs["palette"]
        finish = ("GLITTER YES: a few tiny isolated mineral glints on the shoulder, chest or tail; keep the face, eye and silhouette clean. The background and lavender frame have the approved prismatic holographic sheen, diagonal rainbow streaks and a few crisp painted stars. No frosted glitter blanket, rainbow dust, haze, grain or blurry body."
                  if glitter == "Yes" else
                  "GLITTER NO: smooth clean colored monster surfaces, ordinary matte illustrated scenery and a polished lavender frame. No body glitter, rainbow foil, prismatic streaks or floating starbursts.")
        horn_text = ("exactly one naturally tapered warm honey-GOLD spiral horn, defined spiral grooves and antique-bronze shadows"
                     if horn == "Spiral" else "exactly one elongated translucent faceted DIAMOND crystal horn, crisp flat planes, no spiral grooves")
        prompt = f"""Create ONE finished YUNIPALS collectible card as a 1024 x 1536 PNG, portrait 2:3, with genuine transparent exterior.
Reference #1 is the SPECIFIC OG {color} {monster_type}. Preserve its visible species identity, facial structure, anatomy, complete silhouette, markings and proportions. This is also the correct target colorway.
Reference #2 is the APPROVED LOCKED CARD DESIGN. Copy its exact lavender frame, purple typography, official logo placement, polished clean 3D illustration quality, composition scale and finish policy. Its dragon is only a style example; the new character must be the specific monster in reference #1.
Reference #3 is the OFFICIAL FLAT YUNIPALS LOGO. Preserve its recognizable pink badge, dark outlined pale-gold face, green eye and mint fins exactly.
Reference #4 is the ACTUAL OG {color} {monster_type}, the authority for the ENTIRE CHARACTER PALETTE. Match all corresponding body, hair/mane/feathers, shell, fins, feet, eye/iris, markings and accessory colors, including hue, saturation, lightness, highlights and shadows: {palette['description']}. Its exact colorway overrides every conflicting color in reference #1 or #2. Preserve the requested horn trait and card design; do not copy its background or framing. The color name alone is insufficient.

TRAITS: Type {monster_type}; main body color {color}; horn {horn}; glitter {glitter}.
Preserve the OG monster's face, eyes, body shape, markings, distinctive fins/mane/wings, proportions and stance. Apply the complete OG {color} {monster_type} colorway from reference #4 to every corresponding character region, including secondary details and eyes. Preserve the shapes of its markings while matching their OG colors; do not retain colors from a different colorway. Do not increase saturation for dramatic lighting or let holographic reflections recolor the body. Keep clothing, eyewear and anatomical features from the OG identity. Forehead horn: {horn_text}, naturally attached and clearly visible. No extra unicorn horns.
Use crisp dimensional colored surfaces with clean edges and readable form shading, as in the locked design. No blurry eyes, soft-focus body, dense speckles, frosted coating or glowing body outline.
FINISH: {finish}

SCENE: meadow-{color.lower()}: cheerful rolling green hills, soft clouds and a small distant windmill, with a gentle {color.lower()} accent in the wildflowers; preserve the approved meadow landmarks. Replace reference #1's lunar/rocky setting completely. One full-body monster, naturally grounded or hovering if that is its OG stance. Fit its complete horn, wings/fins, feet and tail inside the art window.
FRAME: identical signature soft polished LAVENDER #c7c9f9 frame for every body color; grape-purple #7e22ce inner outlines and accents, pale white/lavender header and bottom nameplate. Never recolor the frame to match the creature. Follow the approved reference's rounded silhouette, proportions and thin inset details.
Exact top text: YUNIPALS. Exact bottom text: {monster_type.upper()}. Bold chunky Archivo Black-style grape-purple lettering, centered and fully legible. Put the supplied official flat pink logo at the top-left header as in the approved design. These are the ONLY words. No level, number, rarity badge, stats, extra captions or invented text.
Keep the complete border with equal small transparent margins on all four sides, clean rounded corners, no exterior drop shadow or halo, and no visible canvas-edge pixels. This is a single premium card in the locked design, not a layout comparison.
"""
        design = {**frame_design("brand", color), "decision": "user-locked lavender-crisp-v1", "styleLock": registry["designLock"]["id"]}
        fingerprint = digest(json.dumps({"recipe": RECIPE_VERSION, "traits": traits, "refs": refs, "prompt": prompt}, sort_keys=True).encode())
        matches = [read_json(path) for path in sorted((lab / "runs").glob("*/run.json")) if read_json(path)["fingerprint"] == fingerprint]
        if matches and not new_candidate:
            return next_stage(lab, matches[-1]["id"])
        attempt = len(matches) + 1
        run_id = f"{traits['key']}-{fingerprint[:10]}-a{attempt:02}"
        path = run_path(lab, run_id)
        path.parent.mkdir(parents=True)
        run = {"schemaVersion": 1, "id": run_id, "recipeVersion": RECIPE_VERSION,
            "fingerprint": fingerprint, "attempt": attempt, "createdAt": now(),
            "executionMode": "codex-subscription-assisted", "purpose": "locked-design-sample",
            "traits": traits, "design": design, "references": refs, "referenceProvenance": palette,
            "paletteProvenance": palette,
            "backgroundModifier": f"meadow-{color.lower()}: preserve green hills, soft clouds and the distant windmill",
            "stageOrder": ["card"], "prompts": {"card": prompt}, "stages": {},
            "review": {"decision": "pending", "note": "New sample in user-approved locked design"}}
        (path.parent / "card.prompt.txt").write_text(prompt)
        write_json(path, run)
    return next_stage(lab, run_id)


def prepare_color(lab, source_run):
    with locked(lab):
        source = read_json(run_path(lab, source_run))
        if not next_stage(lab, source_run)["complete"]:
            raise ValueError("Finish the source artwork before correcting its color")
        traits = source["traits"]
        registry = read_json(lab / "references.json")
        palette = palette_reference(registry, traits["type"], traits["color"])
        refs = {**source["references"], "source": snapshot(lab, source["stages"][source["stageOrder"][-1]]["path"]),
                "palette": snapshot(lab, palette["image"])}
        prompt = f"""Use case: precise-object-edit.
Image #1 is the EDIT TARGET: the exact {traits['color']} {traits['type']} YUNIPALS card.
Image #2 is the ACTUAL OG {traits['color']} {traits['type']}, the authority for the COMPLETE SPECIES-SPECIFIC COLORWAY, including secondary details and eyes.
Output one 1024 x 1536 PNG, portrait 2:3, with genuine transparent exterior.

Correct the ENTIRE MONSTER COLORWAY in image #1 to match the actual same-species, same-color OG in image #2. Apply its exact corresponding colors to body, hair/mane/feathers, shell, fins, feet, eye/iris, markings and accessories. Do not keep secondary colors from the old blue character. Image #1 controls geometry and design; image #2 controls ALL character colors except the explicitly requested horn trait.
OG PALETTE: {palette['description']}
Match the original OG hue, restrained saturation, lightness and warm/cool relationships between lit surfaces, midtones and shadows. Do not interpret the word {traits['color']} as a generic vivid paint. The OG image is the color authority. Do not exaggerate saturation or make the body neon. Preserve crisp clean dimensional surfaces, readable form shading and sharp eye/face detail. Do not add grain, frost, blur, a cloudy glitter blanket or an outline glow.

STRICT INVARIANTS: preserve image #1's EXACT species identity, pose, silhouette, camera, crop, proportions, facial geometry, eye shapes, marking shapes, accessory shapes, fins/mane/feathers/wings shapes, {traits['horn']} horn, meadow, sky, windmill, all existing background star positions and rainbow streaks, official flat pink logo, lavender border, purple lettering, exact YUNIPALS header and exact {traits['type'].upper()} footer. No anatomy or composition changes. The old hair, eye and marking COLORS are intentionally NOT invariant: replace them with their corresponding colors from image #2. Preserve their shapes. Keep image #1's requested horn trait, stance and scene; do not replace the monster or change anatomy.
{'Keep only the existing sparse tiny body glints. Preserve the complete approved holographic background and frame; no body rainbow recoloring.' if traits['glitter'] == 'Yes' else 'Keep this a classic non-glitter monster and non-holographic card.'}
Keep every edge of the complete rounded lavender border, equal transparent margins, no exterior shadow, halo or visible canvas-edge pixels. This is a precise local color correction, not a new card design.
"""
        fingerprint = digest(json.dumps({"purpose": "og-species-palette-correction-v2", "source": source_run, "refs": refs, "prompt": prompt}, sort_keys=True).encode())
        run_id = f"{traits['key']}-palette-{fingerprint[:10]}-a01"
        path = run_path(lab, run_id)
        if path.exists():
            return next_stage(lab, run_id)
        run = {**source, "id": run_id, "fingerprint": fingerprint, "createdAt": now(),
               "purpose": "color-correction", "sourceRunId": source_run, "recipeVersion": RECIPE_VERSION, "paletteProvenance": palette,
               "references": refs, "stageOrder": ["palette"], "prompts": {"palette": prompt},
               "stages": {}, "review": {"decision": "pending", "note": "OG color correction; original artwork preserved"}}
        path.parent.mkdir(parents=True)
        (path.parent / "palette.prompt.txt").write_text(prompt)
        write_json(path, run)
    return next_stage(lab, run_id)


def prepare_revision(lab, source_run, frame_style, new_candidate=False):
    with locked(lab):
        source = read_json(run_path(lab, source_run))
        if not next_stage(lab, source_run)["complete"]:
            raise ValueError("Finish the source card before preparing its design revision")
        registry = read_json(lab / "references.json")
        check_frame_selection(registry, frame_style)
        traits = source["traits"]
        design = frame_design(frame_style, traits["color"])
        refs = {"og": source["references"]["og"],
                "logo": snapshot(lab, registry["logo"]),
                "source": snapshot(lab, source["stages"][source["stageOrder"][-1]]["path"])}
        horn = (
            "Replace the ivory forehead horn with the OG normal SPIRAL horn: a naturally "
            "tapered, refined golden horn, warm honey-gold with antique bronze shadows and "
            "soft golden-beige highlights, distinct spiraling grooves. It must read as GOLD, "
            "not white, ivory, marshmallow or an exaggerated soft-serve cone. Keep its "
            "forehead attachment and the monster's face intact."
            if traits["horn"] == "Spiral" else
            "Preserve the existing translucent faceted DIAMOND horn exactly; do not turn it into gold or a spiral."
        )
        prompt = f"""Edit the attached finished YUNIPALS trading card into a corrected brand-study candidate.
Output one 1024 x 1536 PNG, portrait 2:3, transparent exterior.
Image #1 is the exact source card. Preserve this OG {traits['color']} {traits['type']}'s
face, anatomy, colors, markings, pose, full body, meadow, windmill and composition.
Image #2 is the OFFICIAL Yunipals logo downloaded from https://www.yunipals.com/.

HORN CORRECTION: {horn}

FRAME COMPARISON — {design['label']}:
Change the outer frame's dominant material color to {design['frameColor']}.
{'Use a soft polished LAVENDER frame matching the Yunipals website CI, with grape-purple recessed edge detail.' if frame_style == 'brand' else f'Use a rich polished {traits["color"].upper()} enamel frame that clearly matches the NFT body color, with subtle darker-blue bevels.'}
Replace the previous gold frame, gold nameplate rims and gold lettering. Gold is
reserved for a Spiral horn; the frame must visibly read as the requested color.
Use thin grape-purple #7e22ce inner pinstripes and a restrained purple-to-cyan accent.
Keep a premium clean rounded collectible-card silhouette with an intact border.

OFFICIAL BRANDING:
Replace the old 3D beige dragon medallion with the EXACT supplied official flat logo:
dark outlined pale-gold dragon head, green eye, mint fins, hot-pink circle, white sparkles.
Keep the logo a faithful flat graphic, not a newly illustrated 3D dragon. Keep its
pink badge visible and recognizable, placed cleanly in the top-left header area.
Use a pale frosted-glass white/lavender header and matching bottom nameplate.
Exact header text YUNIPALS in chunky Archivo Black-style sans-serif, grape #7e22ce.
Exact bottom name {traits['type'].upper()}, same grape-purple brand typography.
These are the only words. No level, stats, badge text or added labels.

FINISH:
{'Retain clearly visible glitter embedded in the monster BODY and holographic rainbow foil OVER the card ART. Keep the original face and color readable; leave the new frame, logo and text crisp.' if traits['glitter'] == 'Yes' else 'Keep ordinary non-glitter monster surfaces and a non-holographic card. Do not add glitter, rainbow foil, sparkles or prismatic effects to the creature or scene.'}
Keep transparent margins around all four sides, rounded corners, no exterior halo,
no drop shadow, no canvas-edge pixels. Preserve the source card's character identity.
"""
        fingerprint = digest(json.dumps({"recipe": RECIPE_VERSION, "traits": traits,
            "design": design, "refs": refs, "prompt": prompt}, sort_keys=True).encode())
        matches = [read_json(path) for path in sorted((lab / "runs").glob("*/run.json"))
                   if read_json(path)["fingerprint"] == fingerprint]
        if matches and not new_candidate:
            return next_stage(lab, matches[-1]["id"])
        attempt = len(matches) + 1
        run_id = f"{traits['key']}-{fingerprint[:10]}-a{attempt:02}"
        directory = lab / "runs" / run_id
        directory.mkdir(parents=True, exist_ok=False)
        run = {"schemaVersion": 1, "id": run_id, "recipeVersion": RECIPE_VERSION,
               "fingerprint": fingerprint, "attempt": attempt, "createdAt": now(),
               "executionMode": "codex-subscription-assisted", "traits": traits, "design": design,
               "sourceRunId": source_run, "references": refs,
               "referenceProvenance": source["referenceProvenance"],
               "backgroundModifier": source["backgroundModifier"],
               "stageOrder": ["revision"], "prompts": {"revision": prompt}, "stages": {},
               "review": {"decision": "pending", "note": ""}}
        (directory / "revision.prompt.txt").write_text(prompt)
        write_json(directory / "run.json", run)
    return next_stage(lab, run_id)


def prepare_material(lab, source_run):
    """Prepare a separate clean print texture; never replace canonical artwork."""
    with locked(lab):
        source = read_json(run_path(lab, source_run))
        if not next_stage(lab, source_run)["complete"]:
            raise ValueError("Finish the source card before preparing its print layer")
        refs = {**source["references"], "source": snapshot(lab, source["stages"][source["stageOrder"][-1]]["path"])}
        prompt = f"""Use case: precise-object-edit.
Edit the attached exact {source['traits']['color']} {source['traits']['type']} trading card into a CLEAN PRINT TEXTURE for a real-time physical TCG foil viewer.
Output one 1024 x 1536 PNG with the SAME transparent margins and intact rounded card silhouette.
Change ONLY the painted-on whole-card holographic lighting: REMOVE every diagonal rainbow streak, lens flare, large floating four-point sparkle/starburst, white sparkle overlay and rainbow cast across the background and card scene. Restore a clean natural blue sky, white clouds and green meadow behind those effects. Make the lavender frame a clean evenly lit polished print, without painted rainbow glare.
KEEP the monster's fine embedded BODY glitter as tiny subtle specks, not floating starbursts. Keep its {source['traits']['horn']} forehead horn exactly {'warm honey-gold with spiral grooves' if source['traits']['horn']=='Spiral' else 'faceted clear diamond crystal'}.
STRICT INVARIANTS: preserve the SAME character identity, face, eye, full body, pose, silhouette, markings, colors, ear fins, tail, meadow, windmill, camera, crop, header, lavender frame geometry, official flat pink Yunipals logo, and purple lettering. Preserve the exact text YUNIPALS and YUNIDRAGON with the existing font and placement. Do not redesign or add anything. No numbers, labels, badges or new wording.
This is a diffuse printed illustration. ALL card-surface holographic reflections will be rendered by the browser later. Do not paint a foil effect, rainbow, glitter veil, starbursts, specular light stripe or glare into this texture. Preserve normal soft illustration lighting and subtle tiny monster-body glitter only.
Keep the exact portrait 2:3 composition, complete card border and genuine transparent exterior. No exterior halo or shadow.
"""
        fingerprint = digest(json.dumps({"purpose": "tcg-clean-print-v1", "source": source_run, "refs": refs, "prompt": prompt}, sort_keys=True).encode())
        run_id = f"{source['traits']['key']}-print-{fingerprint[:10]}-a01"
        path = run_path(lab, run_id)
        if path.exists():
            return next_stage(lab, run_id)
        run = {**source, "id": run_id, "fingerprint": fingerprint, "createdAt": now(),
               "purpose": "material-print", "sourceRunId": source_run,
               "design": {"frameStyle": "material-print", "label": "Internal clean print layer"},
               "references": refs, "stageOrder": ["print"], "prompts": {"print": prompt},
               "stages": {}, "review": {"decision": "pending", "note": "Material preview texture; canonical card unchanged"}}
        path.parent.mkdir(parents=True)
        (path.parent / "print.prompt.txt").write_text(prompt)
        write_json(path, run)
    return next_stage(lab, run_id)


def prepare_clarity(lab, source_run, classic_run):
    """Prepare an image edit for review without replacing accepted artwork."""
    with locked(lab):
        source = read_json(run_path(lab, source_run))
        classic = read_json(run_path(lab, classic_run))
        if not all(next_stage(lab, run)["complete"] for run in [source_run, classic_run]):
            raise ValueError("Finish both reference cards before preparing a clarity edit")
        if (source["traits"]["glitter"] != "Yes" or classic["traits"]["glitter"] != "No"
                or any(source["traits"][key] != classic["traits"][key] for key in ["type", "color", "horn"])):
            raise ValueError("Use matching glitter and classic variants as the references")
        refs = {**source["references"],
                "source": snapshot(lab, source["stages"][source["stageOrder"][-1]]["path"]),
                "clarity": snapshot(lab, classic["stages"][classic["stageOrder"][-1]]["path"])}
        prompt = f"""Use case: precise-object-edit.
Image #1 is the EDIT TARGET: the exact approved Blue Yunidragon holographic trading card with a {source['traits']['horn']} horn.
Image #2 is a SURFACE-CLARITY REFERENCE ONLY: the same monster's classic card. Do not copy its pose, framing, proportions or composition.
Output ONE 1024 x 1536 portrait PNG with genuine transparent exterior.

Change ONLY the monster's surface rendering in IMAGE #1. Remove the dense frosted glitter coating, rainbow dust, milky haze and noisy sparkling blanket that soften its face and body. Restore the clean sharp premium 3D illustration finish seen in image #2: crisply defined eye and eyelids, nose, mouth, turquoise face markings, body segments, fins, feet and tail; smooth saturated blue and mint skin, clear form shading and sharp silhouette. Preserve the exact existing anatomy, pose and positions in image #1. Keep the {source['traits']['horn']} horn unchanged, including its {'warm honey-gold spiral grooves' if source['traits']['horn']=='Spiral' else 'clear faceted diamond crystal'}.
Glitter=Yes must remain: retain only a few TINY, SPARSE embedded mineral glints on the chest, shoulder/back and tail. Keep the eye, face and contour clean and readable. No frost, cloudy sparkle veil, gritty noise, glowing body outline, blur or soft focus. The monster should look clean, dimensional and crisp at thumbnail size.

STRICT INVARIANTS: preserve image #1's complete lavender card frame, exact YUNIPALS header, exact YUNIDRAGON footer, official flat pink logo, all lettering, camera, character geometry, pose, background meadow, windmill, sky, rainbow streaks, and the positions/shapes of its existing large painted stars. The background and frame must KEEP their approved holographic treatment. Do not move, add or remove stars or scene objects. Do not change words, border shape, crop, scale or transparent margins. This is a local surface-material correction, not a new illustration or sharpening filter.
Keep all four card edges intact, rounded silhouette, clean transparent exterior, no exterior shadow or halo and no visible canvas-edge pixels.
"""
        fingerprint = digest(json.dumps({"purpose": "body-clarity-v1", "refs": refs, "prompt": prompt}, sort_keys=True).encode())
        run_id = f"{source['traits']['key']}-clarity-{fingerprint[:10]}-a01"
        path = run_path(lab, run_id)
        if path.exists():
            return next_stage(lab, run_id)
        run = {**source, "id": run_id, "fingerprint": fingerprint, "createdAt": now(),
               "purpose": "body-clarity", "sourceRunId": source_run,
               "design": {"frameStyle": "body-clarity", "label": "Crisp body proof"},
               "references": refs, "stageOrder": ["clarity"], "prompts": {"clarity": prompt},
               "stages": {}, "review": {"decision": "pending", "note": "Clarity proof; accepted original unchanged"}}
        path.parent.mkdir(parents=True)
        (path.parent / "clarity.prompt.txt").write_text(prompt)
        write_json(path, run)
    return next_stage(lab, run_id)


def run_path(lab, run_id):
    if not re.fullmatch(r"[a-z0-9-]{1,180}", run_id):
        raise ValueError("Invalid run ID")
    return lab / "runs" / run_id / "run.json"


def check_references(lab, run):
    for reference in run["references"].values():
        if digest(asset(lab, reference["path"]).read_bytes()) != reference["sha256"]:
            raise ValueError("A reference changed: prepare a new run before continuing")
    for result in run["stages"].values():
        if digest(asset(lab, result["path"]).read_bytes()) != result["sha256"]:
            raise ValueError("A completed stage changed on disk")


def next_stage(lab, run_id):
    run = read_json(run_path(lab, run_id))
    check_references(lab, run)
    pending = next((key for key in run["stageOrder"] if key not in run["stages"]), None)
    result = {"runId": run_id, "manifest": str(run_path(lab, run_id)),
        "complete": pending is None, "traits": run["traits"], "review": run["review"]}
    if pending:
        og = str(asset(lab, run["references"]["og"]["path"]))
        logo = str(asset(lab, run["references"]["logo"]["path"]))
        if pending == "clarity":
            inputs = [str(asset(lab, run["references"][key]["path"])) for key in ["source", "clarity"]]
        elif pending == "palette":
            inputs = [str(asset(lab, run["references"][key]["path"])) for key in ["source", "palette"]]
        elif pending == "print":
            inputs = [str(asset(lab, run["references"]["source"]["path"]))]
        elif pending == "revision":
            inputs = [str(asset(lab, run["references"]["source"]["path"])), logo]
        elif pending == "creature":
            inputs = [og]
        elif pending == "card" and "style" in run["references"]:
            inputs = [str(asset(lab, run["references"][key]["path"])) for key in ["og", "style", "logo", "palette"]]
        elif pending == "card":
            inputs = [str(asset(lab, run["stages"]["creature"]["path"])), og, logo]
        else:
            inputs = [str(asset(lab, run["stages"]["card"]["path"]))]
        result["nextStage"] = {"id": pending, "prompt": run["prompts"][pending],
            "inputs": inputs, "size": "1024x1024" if pending == "creature" else "1024x1536",
            "transparentBackground": pending != "creature",
            "destination": str(run_path(lab, run_id).parent / f"{pending}.png")}
    return result


def image_metrics(path, stage):
    with Image.open(path) as picture:
        picture.verify()
    with Image.open(path) as picture:
        # Built-in generation can return a native size rather than the preferred
        # API size. Retain those original pixels and validate the intended aspect.
        ratio = 1 if stage == "creature" else 2 / 3
        if (picture.format != "PNG" or min(picture.size) < 768 or max(picture.size) > 4096
                or abs(picture.width / picture.height - ratio) > 0.01):
            raise ValueError(f"Expected a high-resolution {'square' if stage == 'creature' else '2:3 portrait'} PNG, got {picture.format} {picture.size}")
        if stage == "creature":
            return {"width": picture.width, "height": picture.height, "format": "PNG"}
        if "A" not in picture.getbands():
            raise ValueError("Card output needs a transparent exterior")
        alpha = picture.getchannel("A")
        hist = alpha.histogram()
        transparent = hist[0] / (picture.width * picture.height)
        edge = list(alpha.crop((0, 0, picture.width, 1)).getdata())
        edge += list(alpha.crop((0, picture.height - 1, picture.width, picture.height)).getdata())
        edge += list(alpha.crop((0, 0, 1, picture.height)).getdata())
        edge += list(alpha.crop((picture.width - 1, 0, picture.width, picture.height)).getdata())
        edge_visible = sum(value > 8 for value in edge)
        if transparent < 0.005 or transparent > 0.45 or edge_visible:
            raise ValueError("Invalid card cutout: regenerate with clean transparent margins")
        return {"width": picture.width, "height": picture.height, "format": "PNG",
            "transparentFraction": round(transparent, 6), "visibleCanvasEdgePixels": edge_visible,
            "visualReview": "pending; inspect silhouette and border on light and dark backgrounds"}


def accept(lab, run_id, stage, image):
    with locked(lab):
        description = next_stage(lab, run_id)
        if description["complete"] or description["nextStage"]["id"] != stage:
            raise ValueError("Only the next incomplete stage can be accepted")
        run = read_json(run_path(lab, run_id))
        metrics = image_metrics(image, stage)
        directory = run_path(lab, run_id).parent
        destination = directory / f"{stage}.png"
        if destination.exists():
            raise ValueError("Stage destination already exists; existing results are never overwritten")
        temporary = directory / f".{stage}.incoming.png"
        shutil.copyfile(image, temporary)
        temporary.replace(destination)
        run["stages"][stage] = {"path": relative(destination, lab), "sha256": digest(destination.read_bytes()),
            "recordedAt": now(), "provider": "codex-image-gen", "qa": metrics}
        write_json(run_path(lab, run_id), run)
    return next_stage(lab, run_id)


def review(lab, run_id, decision, note=""):
    with locked(lab):
        result = next_stage(lab, run_id)
        if not result["complete"]:
            raise ValueError("Finish every stage before reviewing the candidate")
        run = read_json(run_path(lab, run_id))
        if run["review"]["decision"] != "pending":
            raise ValueError("Review already recorded; create a new candidate for further changes")
        if decision == "accepted" and run.get("purpose") not in ["material-print", "body-clarity", "color-correction"]:
            canonical = lab / "canonical.json"
            values = read_json(canonical) if canonical.exists() else {}
            key = run["traits"]["key"]
            if key in values and values[key] != run_id:
                raise ValueError("This variant already has accepted artwork; it will not be replaced")
            values[key] = run_id
            write_json(canonical, values)
        run["review"] = {"decision": decision, "note": note[:2000], "recordedAt": now()}
        write_json(run_path(lab, run_id), run)
    return next_stage(lab, run_id)


def finalize(lab, run_id, visual_note=None):
    with locked(lab):
        result = next_stage(lab, run_id)
        if not result["complete"]:
            raise ValueError("Finish generation before finalizing previews")
        run = read_json(run_path(lab, run_id))
        directory = run_path(lab, run_id).parent
        qa_directory = directory / "qa"
        qa_directory.mkdir(exist_ok=True)
        previews = []
        for stage, record in run["stages"].items():
            source = asset(lab, record["path"])
            preview = directory / f"{stage}_preview.webp"
            if not preview.exists():
                subprocess.run(["convert", str(source), "-resize", "520x780>", "-quality", "82", str(preview)], check=True, capture_output=True)
            record["preview"] = relative(preview, lab)
            if stage == "creature":
                continue
            record["qa"]["previews"] = {}
            for background in ["white", "black", "checkerboard"]:
                target = qa_directory / f"{stage}-{background}.png"
                if not target.exists():
                    if background == "checkerboard":
                        args = ["convert", "-size", "384x576", "pattern:checkerboard", "(", str(source), "-resize", "384x576!", ")", "-compose", "over", "-composite", str(target)]
                    else:
                        args = ["convert", str(source), "-resize", "384x576!", "-background", background, "-alpha", "remove", "-alpha", "off", str(target)]
                    subprocess.run(args, check=True, capture_output=True)
                record["qa"]["previews"][background] = relative(target, lab)
                previews.append(str(target))
            if visual_note:
                record["qa"]["visualReview"] = {"status": "agent-reviewed", "note": visual_note[:2000], "recordedAt": now(), "humanApproval": "pending"}
        write_json(run_path(lab, run_id), run)
    return {"runId": run_id, "complete": True, "qaPreviews": previews, "humanApproval": run["review"]["decision"]}


def check_frame_selection(registry, frame_style):
    selected = registry.get("gallery", {}).get("frameStyle")
    if selected and frame_style != selected:
        raise ValueError("Use the selected lavender frame for new cards")


def export(lab, destination):
    destination.mkdir(parents=True, exist_ok=True)
    assets = destination / "assets"
    assets.mkdir(exist_ok=True)
    previous = destination / "data.json"
    previous_assets = set(public_asset_paths(read_json(previous))) if previous.exists() else set()
    registry = read_json(lab / "references.json")
    data = {"schemaVersion": 1, "recipeVersion": RECIPE_VERSION, "executionMode": "codex-subscription-assisted",
        "exportedAt": now(), "catalog": read_json(DICTIONARY), "references": {}, "candidates": []}
    selection = registry.get("gallery", {})
    if selection:
        data["gallery"] = selection
    if registry.get("designLock"):
        data.setdefault("gallery", {})["designLock"] = {key: value for key, value in registry["designLock"].items() if key != "styles"}
    if registry.get("branding"):
        data["branding"] = registry["branding"]
        brand_logo = "yunipals-official-logo.png"
        shutil.copyfile(asset(lab, registry["logo"]), assets / brand_logo)
        data["brandLogo"] = f"assets/{brand_logo}"
    for name, reference in registry["types"].items():
        target = f"reference-{name.lower()}.png"
        shutil.copyfile(asset(lab, reference["image"]), assets / target)
        data["references"][name] = {**reference, "image": f"assets/{target}",
            "sha256": digest((assets / target).read_bytes())}
    def public_palette(reference):
        target = f"palette-{reference['color'].lower()}-{digest(asset(lab, reference['image']).read_bytes())[:12]}.png"
        shutil.copyfile(asset(lab, reference["image"]), assets / target)
        return {**reference, "image": f"assets/{target}"}

    for path in sorted((lab / "runs").glob("*/run.json")):
        run = read_json(path)
        if run.get("purpose") in ["material-print", "body-clarity", "color-correction"]:
            continue
        if selection.get("frameStyle") and run.get("design", {}).get("frameStyle") != selection["frameStyle"]:
            continue
        check_references(lab, run)
        item = {key: run[key] for key in ["id", "traits", "createdAt", "attempt", "review", "fingerprint"]}
        item["recipeVersion"] = run["recipeVersion"]
        item["design"] = run.get("design", {"frameStyle": "original", "label": "Original gold"})
        if run.get("paletteProvenance"):
            item["paletteReference"] = public_palette(run["paletteProvenance"])
        item["stageOrder"] = run["stageOrder"]
        item["stages"] = {}
        item["complete"] = all(key in run["stages"] for key in run["stageOrder"])
        for stage, result in run["stages"].items():
            target = f"{run['id']}-{stage}.png"
            shutil.copyfile(asset(lab, result["path"]), assets / target)
            item["stages"][stage] = {**result, "path": f"assets/{target}"}
            if result.get("preview"):
                thumbnail = f"{run['id']}-{stage}_preview.webp"
                shutil.copyfile(asset(lab, result["preview"]), assets / thumbnail)
                item["stages"][stage]["preview"] = f"assets/{thumbnail}"
            if result["qa"].get("previews"):
                qa_paths = {}
                for background, source in result["qa"]["previews"].items():
                    qa_name = f"{run['id']}-{stage}-{background}.png"
                    shutil.copyfile(asset(lab, source), assets / qa_name)
                    qa_paths[background] = f"assets/{qa_name}"
                item["stages"][stage]["qa"] = {**result["qa"], "previews": qa_paths}
        item["prompts"] = run["prompts"]
        final_stage = run["stageOrder"][-1]
        item["image"] = item["stages"].get(final_stage, {}).get("path")
        data["candidates"].append(item)
    for path in sorted((lab / "runs").glob("*/run.json")):
        run = read_json(path)
        if (run.get("purpose") != "material-print" or "print" not in run["stages"]
                or run["review"]["decision"] == "rejected"):
            continue
        target_item = next((item for item in data["candidates"] if item["id"] == run["sourceRunId"]), None)
        if target_item is None:
            continue
        check_references(lab, run)
        result = run["stages"]["print"]
        target = f"{run['id']}.png"
        shutil.copyfile(asset(lab, result["path"]), assets / target)
        target_item["materialPrint"] = {"path": f"assets/{target}", "sha256": result["sha256"], "runId": run["id"], "review": run["review"]}
    corrections = [read_json(path) for path in (lab / "runs").glob("*/run.json")]
    for run in sorted(corrections, key=lambda item: (item["createdAt"], item["id"])):
        purpose = run.get("purpose")
        stage = {"body-clarity": "clarity", "color-correction": "palette"}.get(purpose)
        if not stage or stage not in run["stages"] or run["review"]["decision"] == "rejected":
            continue
        item = next((item for item in data["candidates"] if item["id"] == run["sourceRunId"]), None)
        if item is None:
            continue
        check_references(lab, run)
        result = run["stages"][stage]
        target = f"{run['id']}-{stage}.png"
        shutil.copyfile(asset(lab, result["path"]), assets / target)
        record = {**result, "path": f"assets/{target}"}
        if result.get("preview"):
            name = f"{run['id']}-{stage}_preview.webp"
            shutil.copyfile(asset(lab, result["preview"]), assets / name)
            record["preview"] = f"assets/{name}"
        qa = {}
        for background, source in result["qa"].get("previews", {}).items():
            name = f"{run['id']}-{stage}-{background}.png"
            shutil.copyfile(asset(lab, source), assets / name)
            qa[background] = f"assets/{name}"
        record["qa"] = {**result["qa"], "previews": qa}
        item["stages"][stage] = record
        if stage not in item["stageOrder"]:
            item["stageOrder"].append(stage)
        item["prompts"][stage] = run["prompts"][stage]
        item["image"] = record["path"]
        item["clarityProof" if stage == "clarity" else "colorProof"] = {"runId": run["id"], "review": run["review"]}
        if stage == "palette":
            item["paletteReference"] = public_palette(run["paletteProvenance"])
    for name in public_asset_paths(data):
        if not (destination / name).is_file():
            raise ValueError(f"Export references a missing public asset: {name}")
    write_json(destination / "data.json", data)
    # Remove only formerly exported files. Source runs remain in the local lab.
    for name in previous_assets - set(public_asset_paths(data)):
        (destination / name).unlink(missing_ok=True)
    return {"candidates": len(data["candidates"]), "completed": sum(x["complete"] for x in data["candidates"]),
        "output": str(destination)}


def public_asset_paths(data):
    """Return every deployed image URL, rejecting private lab paths in manifests."""
    paths = {reference["image"] for reference in data["references"].values()}
    if data.get("brandLogo"):
        paths.add(data["brandLogo"])
    for candidate in data["candidates"]:
        if candidate.get("paletteReference"):
            paths.add(candidate["paletteReference"]["image"])
        if candidate.get("materialPrint"):
            paths.add(candidate["materialPrint"]["path"])
        if candidate.get("image"):
            paths.add(candidate["image"])
        for stage in candidate["stages"].values():
            paths.add(stage["path"])
            if stage.get("preview"):
                paths.add(stage["preview"])
            paths.update(stage["qa"].get("previews", {}).values())
    for name in paths:
        if not re.fullmatch(r"assets/[a-zA-Z0-9_.-]+\.(png|webp)", name):
            raise ValueError(f"Image URL must point into the public assets directory: {name}")
    return sorted(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", type=Path, default=DEFAULT_LAB)
    commands = parser.add_subparsers(dest="command", required=True)
    register_parser = commands.add_parser("register-reference")
    register_parser.add_argument("--type", required=True)
    register_parser.add_argument("--image", type=Path, required=True)
    register_parser.add_argument("--identity", required=True)
    register_parser.add_argument("--source", required=True)
    register_parser.add_argument("--legacy-type")
    register_parser.add_argument("--token-id")
    register_parser.add_argument("--chain-id", type=int)
    register_parser.add_argument("--contract")
    palette_parser = commands.add_parser("register-palette")
    palette_parser.add_argument("--color", required=True)
    palette_parser.add_argument("--image", required=True, type=Path)
    palette_parser.add_argument("--description", required=True)
    palette_parser.add_argument("--source", required=True)
    palette_parser.add_argument("--type")
    commands.add_parser("prepare-color").add_argument("--source-run", required=True)
    prepare_parser = commands.add_parser("prepare")
    for flag in ["type", "color", "horn", "glitter"]:
        prepare_parser.add_argument(f"--{flag}", required=True)
    prepare_parser.add_argument("--new-candidate", action="store_true")
    prepare_parser.add_argument("--frame-style", choices=["brand", "monster"], default="brand")
    revision_parser = commands.add_parser("prepare-revision")
    revision_parser.add_argument("--source-run", required=True)
    revision_parser.add_argument("--frame-style", required=True, choices=["brand", "monster"])
    revision_parser.add_argument("--new-candidate", action="store_true")
    commands.add_parser("prepare-material").add_argument("--source-run", required=True)
    lock_parser = commands.add_parser("lock-design")
    lock_parser.add_argument("--classic-run", required=True)
    lock_parser.add_argument("--glitter-run", required=True)
    clarity_parser = commands.add_parser("prepare-clarity")
    clarity_parser.add_argument("--source-run", required=True)
    clarity_parser.add_argument("--classic-run", required=True)
    for command in ["next", "accept", "review", "finalize"]:
        sub = commands.add_parser(command)
        sub.add_argument("--run", required=True)
        if command == "accept":
            sub.add_argument("--stage", required=True, choices=["creature", "card", "foil", "revision", "print", "clarity", "palette"])
            sub.add_argument("--image", required=True, type=Path)
        if command == "review":
            sub.add_argument("--decision", required=True, choices=["accepted", "rejected"])
            sub.add_argument("--note", default="")
        if command == "finalize":
            sub.add_argument("--visual-review-note")
    commands.add_parser("export").add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "register-reference":
            result = register_reference(args.lab, args.type, args.image, args.identity,
                args.source, args.legacy_type, args.token_id, args.chain_id, args.contract)
        elif args.command == "register-palette":
            result = register_palette(args.lab, args.color, args.image, args.description, args.source, args.type)
        elif args.command == "prepare-color":
            result = prepare_color(args.lab, args.source_run)
        elif args.command == "prepare":
            result = prepare(args.lab, args.type, args.color, args.horn, args.glitter, args.new_candidate, args.frame_style)
        elif args.command == "prepare-revision":
            result = prepare_revision(args.lab, args.source_run, args.frame_style, args.new_candidate)
        elif args.command == "prepare-material":
            result = prepare_material(args.lab, args.source_run)
        elif args.command == "lock-design":
            result = lock_design(args.lab, args.classic_run, args.glitter_run)
        elif args.command == "prepare-clarity":
            result = prepare_clarity(args.lab, args.source_run, args.classic_run)
        elif args.command == "next":
            result = next_stage(args.lab, args.run)
        elif args.command == "accept":
            result = accept(args.lab, args.run, args.stage, args.image)
        elif args.command == "review":
            result = review(args.lab, args.run, args.decision, args.note)
        elif args.command == "finalize":
            result = finalize(args.lab, args.run, args.visual_review_note)
        else:
            result = export(args.lab, args.directory)
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Art lab: {error}\n")


if __name__ == "__main__":
    main()
