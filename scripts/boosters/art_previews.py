"""Build immutable, source-bound WebP previews of published booster artwork.

The v1 recipe preserves transparency, fits within 520 x 780, and never upscales.
Run against an artwork directory to backfill its published variants. No network
requests or image generation are performed.
"""

import argparse
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import tempfile

from PIL import Image


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exclusive_file(destination, data):
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".preview-", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            os.fchmod(output.fileno(), 0o644)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(name, destination)
        except FileExistsError:
            if destination.is_symlink() or destination.read_bytes() != data:
                raise ValueError("Existing immutable preview differs")
    finally:
        os.unlink(name)


def publish_preview(directory, source, source_sha):
    if not re.fullmatch(r"[a-f0-9]{64}", source_sha):
        raise ValueError("Invalid source artwork fingerprint")
    original = source.read_bytes()
    if digest(original) != source_sha:
        raise ValueError("Source artwork fingerprint mismatch")
    folder = directory / "previews" / "v1"
    image_path = folder / f"{source_sha}.webp"
    manifest_path = folder / f"{source_sha}.json"
    if image_path.exists() and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        preview = image_path.read_bytes()
        with Image.open(BytesIO(preview)) as image:
            valid_image = image.format == "WEBP" and list(image.size) == [manifest.get("width"), manifest.get("height")]
        if not (
            manifest.get("version") == 1
            and manifest.get("sourceSha256") == source_sha
            and manifest.get("sha256") == digest(preview)
            and manifest.get("bytes") == len(preview)
            and valid_image
            and 0 < manifest["width"] <= 520
            and 0 < manifest["height"] <= 780
        ):
            raise ValueError("Existing preview failed verification")
        return manifest
    with Image.open(BytesIO(original)) as image:
        if image.format != "PNG":
            raise ValueError("Preview source must be PNG artwork")
        image = image.convert("RGBA")
        image.thumbnail((520, 780), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="WEBP", quality=78, method=4, exact=True)
        preview = output.getvalue()
        width, height = image.size
    manifest = {
        "version": 1,
        "sourceSha256": source_sha,
        "sha256": digest(preview),
        "width": width,
        "height": height,
        "bytes": len(preview)
    }
    exclusive_file(image_path, preview)
    exclusive_file(manifest_path, (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode())
    return manifest


def backfill(directory):
    sources = set()
    for path in sorted((directory / "catalogs").glob("*/variants/*.json")):
        metadata = json.loads(path.read_text())
        if metadata.get("yunipals", {}).get("status") != "ready":
            continue
        source_sha = metadata["yunipals"]["artworkSha256"]
        if not re.fullmatch(r"[a-f0-9]{64}", source_sha) or not metadata["image"].endswith(f"/art-assets/{source_sha}.png"):
            raise ValueError(f"Published image fingerprint mismatch: {path}")
        sources.add(source_sha)
    if not sources:
        raise ValueError("No published artwork found")
    manifests = [publish_preview(directory, directory / "assets" / f"{sha}.png", sha) for sha in sorted(sources)]
    return {
        "images": len(manifests),
        "originalBytes": sum((directory / "assets" / f"{sha}.png").stat().st_size for sha in sources),
        "previewBytes": sum(item["bytes"] for item in manifests)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(backfill(args.directory), indent=2))
