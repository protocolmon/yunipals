#!/usr/bin/env python3
"""Copy one existing art_runtime.py publication: hashed assets first, immutable metadata last.

No generator, image API, image processing or credentials. Review is read-only;
--apply normally requires a queued variant. --allow-unrevealed explicitly permits
prepublishing the frozen catalog. Both modes refuse replacing published data.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

PUBLIC = "https://api.yunipals.com/yunipals-indexer/v1/boosters/art-assets/"
COMMITMENTS = {
    "base-mainnet-smoke-v1": "0xb80bbfdc7fc11047ea15f7de4a38a9cf5b22e347bfe0eb07b2a7574d533a55ca",
    "base-mainnet-standard-v1": "0x29c9b8dfc3c35854a0396850a4e40da3457cf44a9901157c67564b92d61276ac",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read(path):
    require(path.is_file() and not path.is_symlink(), f"Missing regular artifact: {path}")
    return path.read_bytes()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def plan(source, target, slug, rank, allow_unrevealed=False):
    require(slug in COMMITMENTS and 0 <= rank < 264, "Unknown frozen catalog/variant")
    relative = Path("catalogs") / slug
    manifest = json.loads(read(target / relative / "manifest.json"))
    require(manifest == json.loads(read(source / relative / "manifest.json")), "Source/target catalogs differ")
    descriptor = {k: v for k, v in manifest.items() if k != "artworkHash"}
    require(manifest["artworkHash"] == COMMITMENTS[slug]
            and "0x" + sha(json.dumps(descriptor, sort_keys=True, separators=(",", ":")).encode()) == manifest["artworkHash"],
            "Frozen recipe/reference commitment changed")
    metadata_bytes = read(source / relative / "variants" / f"{rank}.json")
    require(len(metadata_bytes) < 100000, "Unexpected metadata size")
    metadata = json.loads(metadata_bytes)
    y = metadata["yunipals"]
    require(y["status"] == "ready" and y["variantId"] == rank and y["catalogCommitment"] == manifest["artworkHash"], "Wrong published variant")
    dictionary, rest, traits = manifest["dictionary"], rank, {}
    for category, label in reversed(list(zip(["types", "colors", "horns", "glitters"], ["Type", "Color", "Horn", "Glitter"]))):
        values = dictionary[category]
        traits[label] = values[rest % len(values)]["name"]
        rest //= len(values)
    require({item["trait_type"]: item["value"] for item in metadata["attributes"]} == traits, "Metadata traits do not match variant")
    urls = [(metadata["image"], "png")]
    if traits["Glitter"] == "Yes":
        require(isinstance(y.get("holo"), dict) and set(y["holo"]) == {"foreground", "background", "stars"}, "Calibrated holo masks required")
        urls.extend((value, "svg") for value in y["holo"].values())
    else:
        require(y.get("holo") is None, "Matte variants cannot gain foil masks")
    assets = {}
    for url, extension in urls:
        match = re.fullmatch(re.escape(PUBLIC) + r"([0-9a-f]{64}\." + extension + ")", url)
        require(match, "Unapproved asset URL")
        filename = match.group(1)
        data = read(source / "assets" / filename)
        require(len(data) <= 32000000 and sha(data) == filename.split(".")[0], "Asset hash mismatch")
        if extension == "png":
            require(filename.split(".")[0] == y["artworkSha256"], "PNG and metadata hash differ")
        destination = target / "assets" / filename
        if destination.exists():
            require(read(destination) == data, "Existing immutable asset differs")
        assets[filename] = data
    destination = target / relative / "variants" / f"{rank}.json"
    existing = destination.exists()
    if existing:
        require(json.loads(read(destination)) == metadata, "Published variant cannot be replaced")
    elif not allow_unrevealed or (target / "jobs" / slug / f"{rank}.json").exists():
        job = json.loads(read(target / "jobs" / slug / f"{rank}.json"))
        require(job["schemaVersion"] == 1 and job["catalog"] == slug and job["variantId"] == rank
                and job["catalogHash"] == manifest["catalogHash"]
                and job["traits"] == {key.lower(): value for key, value in traits.items()}
                and job["status"] in ("queued", "prepared"), "No matching observed queue job")
    return destination, metadata_bytes, assets, {"catalog": slug, "variantId": rank,
        "alreadyPublished": existing, "allowUnrevealed": allow_unrevealed,
        "artworkSha256": y["artworkSha256"],
        "metadataSha256": sha(metadata_bytes), "assets": sorted(assets)}


def exclusive_file(destination, data):
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".approved-art-", dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            os.fchmod(output.fileno(), 0o644)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError:
            require(read(destination) == data, "Immutable destination changed during install")
        directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def install(source, target, slug, rank, apply=False, allow_unrevealed=False):
    if not apply:
        return {"status": "REVIEWED", **plan(source, target, slug, rank, allow_unrevealed)[3]}
    with (target / ".generation.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        destination, metadata, assets, proof = plan(source, target, slug, rank, allow_unrevealed)
        for filename, data in assets.items():
            exclusive_file(target / "assets" / filename, data)
        if not proof["alreadyPublished"]:
            exclusive_file(destination, metadata)
        return {"status": "ALREADY_PUBLISHED" if proof["alreadyPublished"] else "INSTALLED", **proof}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Output directory from existing art_runtime.py publish")
    parser.add_argument("--directory", type=Path, default=Path("/var/lib/yunipals-booster-artwork"))
    parser.add_argument("--catalog", required=True, choices=sorted(COMMITMENTS))
    parser.add_argument("--variant", required=True, type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--allow-unrevealed", action="store_true", help="Prepublish reviewed artwork from the frozen catalog without an observed reveal job")
    args = parser.parse_args()
    print(json.dumps(install(args.source, args.directory, args.catalog, args.variant, args.apply, args.allow_unrevealed), indent=2))
