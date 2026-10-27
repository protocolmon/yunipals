"""Verify the complete, pre-generated booster catalog without network access.

Rebuild publications from accepted native source runs into a temporary directory,
then compare metadata, PNGs and foil layers with the checked-in public assets.
No generation, credentials, database access or production changes are involved.
"""

import argparse
import json
from pathlib import Path
import tempfile

import art_lab
import art_runtime


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(lab, directory, slug, write_index=False):
    catalog = art_runtime.catalog_path(directory, slug)
    manifest_path = catalog / "manifest.json"
    manifest = art_lab.read_json(manifest_path)
    dictionary = art_lab.read_json(art_lab.DICTIONARY)
    require(manifest["dictionary"] == dictionary, "Trait dictionary mismatch")
    require(
        manifest["recipeSourceSha256"]
        == art_lab.digest(Path(art_lab.__file__).read_bytes()),
        "Frozen generator source changed"
    )
    expected = []
    for monster in dictionary["types"]:
        for color in dictionary["colors"]:
            for horn in dictionary["horns"]:
                for glitter in dictionary["glitters"]:
                    expected.append(
                        art_lab.variant_traits(
                            monster["name"], color["name"], horn["name"], glitter["name"]
                        )
                    )
    require(len(expected) == 264, "Expected the complete 264-variant catalog")
    require(
        {p.name for p in (catalog / "variants").glob("*.json")}
        == {f"{rank}.json" for rank in range(264)},
        "Missing or unexpected variant metadata"
    )
    public_base = manifest["metadataBaseURI"].split("/v1/boosters/art/")[0]
    canonical = art_lab.read_json(lab / "canonical.json")
    entries = []
    assets = set()
    holo = 0
    with tempfile.TemporaryDirectory(prefix="yunipals-art-verify-") as temporary:
        rebuilt = Path(temporary)
        # This verifies all 66 exact OG references, both locked style images,
        # the official logo, source recipe and their frozen commitment.
        recreated_manifest = art_runtime.init_catalog(lab, rebuilt, slug, public_base)
        require(recreated_manifest == manifest, "Frozen reference manifest mismatch")
        for traits in expected:
            rank = traits["variantId"]
            path = catalog / "variants" / f"{rank}.json"
            metadata = art_lab.read_json(path)
            provenance = metadata["provenance"]
            run_id = provenance["runId"]
            require(
                canonical.get(traits["key"]) == run_id,
                f"Variant {rank}: canonical run differs from publication"
            )
            source_path = art_lab.run_path(lab, run_id)
            run = art_lab.read_json(source_path)
            require(run["traits"] == traits, f"Variant {rank}: source traits mismatch")
            require(
                art_lab.next_stage(lab, run_id)["complete"],
                f"Variant {rank}: incomplete generation run"
            )
            stage = run["stages"][provenance["stage"]]
            # Recheck native pixels rather than trusting the historical QA note.
            art_lab.image_metrics(art_lab.asset(lab, stage["path"]), provenance["stage"])
            image_sha = stage["sha256"]
            mapping = directory / "masks" / f"{image_sha}.json"
            if mapping.exists():
                art_runtime.register_masks(
                    rebuilt, art_lab.asset(lab, stage["path"]), mapping
                )
            publication = art_runtime.publish(
                lab, rebuilt, slug, run_id, provenance["stage"]
            )
            require(
                art_lab.read_json(Path(publication["metadata"])) == metadata,
                f"Variant {rank}: rebuilt metadata differs"
            )
            layers = metadata["yunipals"]["holo"]
            require(bool(layers) == bool(rank % 2), f"Variant {rank}: finish mismatch")
            if layers:
                require(
                    set(layers) == {"foreground", "background", "stars"},
                    f"Variant {rank}: incomplete foil layers"
                )
                holo += 1
            names = []
            for url in [metadata["image"], *(layers or {}).values()]:
                name = url.rsplit("/", 1)[1]
                require(
                    url == public_base + "/v1/boosters/art-assets/" + name,
                    f"Variant {rank}: unexpected asset origin"
                )
                published_bytes = (directory / "assets" / name).read_bytes()
                require(
                    art_lab.digest(published_bytes) == name.split(".")[0],
                    f"Variant {rank}: asset hash mismatch: {name}"
                )
                require(
                    (rebuilt / "assets" / name).read_bytes() == published_bytes,
                    f"Variant {rank}: rebuilt asset differs: {name}"
                )
                assets.add(name)
                names.append(name)
            entries.append({
                "variantId": rank,
                "traits": {key: traits[key] for key in ("type", "color", "horn", "glitter")},
                "metadataSha256": art_lab.digest(path.read_bytes()),
                "runId": run_id,
                "runManifestSha256": art_lab.digest(source_path.read_bytes()),
                "artworkSha256": image_sha,
                "assets": sorted(names)
            })
    require(holo == 132 and len(assets) == 660, "Incomplete PNG/foil asset set")
    index = {
        "schemaVersion": 1,
        "catalog": slug,
        "manifestSha256": art_lab.digest(manifest_path.read_bytes()),
        "artworkHash": manifest["artworkHash"],
        "variantCount": len(entries),
        "matteCount": 264 - holo,
        "holoCount": holo,
        "assetCount": len(assets),
        "variants": entries
    }
    index_path = catalog / "complete-assets.json"
    if write_index and not index_path.exists():
        art_lab.write_json(index_path, index)
    require(art_lab.read_json(index_path) == index, "Complete asset index mismatch")
    return {key: index[key] for key in (
        "catalog", "manifestSha256", "variantCount", "matteCount", "holoCount", "assetCount"
    )}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", type=Path, default=art_lab.DEFAULT_LAB)
    parser.add_argument("--directory", type=Path, default=art_runtime.DEFAULT_DIRECTORY)
    parser.add_argument("--catalog", default="base-mainnet-standard-v1")
    parser.add_argument(
        "--write-index", action="store_true",
        help="Create the separate complete-assets.json inventory if it does not exist"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.lab, args.directory, args.catalog, args.write_index), indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error) + "\n")
