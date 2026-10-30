#!/usr/bin/env python3
"""Restore checksum-pinned anime reference images outside Git tracking."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "apps/yunipals-anime-engine/fixtures/assets-manifest.json"
MAX_BYTES = 32 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def destination(root, name):
    path = PurePosixPath(name)
    allowed = (
        name.startswith("apps/yunipals-anime-engine/fixtures/assets/")
        or name == "apps/yunipals-anime-engine/fixtures/review/1.1.0-before-after.jpg"
        or name in ("docs/arena/anime-recipe-v1/board.png", "docs/arena/anime-recipe-v2/board.png")
    )
    if not allowed or path.is_absolute() or ".." in path.parts or str(path) != name:
        raise ValueError(f"Invalid reference asset path: {name}")
    target = root.joinpath(*path.parts)
    if any(part.is_symlink() for part in (target, *target.parents)):
        raise ValueError(f"Reference asset path contains a symlink: {name}")
    return target


def validate_manifest(manifest):
    if manifest.get("version") != "anime-reference-assets/v1":
        raise ValueError("Unsupported reference asset manifest")
    if not re.fullmatch(r"[0-9a-f]{64}", manifest["sha256"]):
        raise ValueError("Invalid archive checksum")
    expected_url = f'https://assets-anime.yunipals.com/tooling/anime-reference-assets/{manifest["sha256"]}.tar.gz'
    if manifest["url"] != expected_url or not 0 < manifest["bytes"] <= MAX_BYTES:
        raise ValueError("Invalid reference archive URL or size")
    files = manifest["files"]
    if not 0 < len(files) <= 100 or sum(item["bytes"] for item in files.values()) > MAX_BYTES:
        raise ValueError("Invalid reference asset count or total size")
    for item in files.values():
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) or not 0 < item["bytes"] <= MAX_BYTES:
            raise ValueError("Invalid reference asset checksum or size")


def cached(root, manifest):
    validate_manifest(manifest)
    complete = True
    for name, expected in manifest["files"].items():
        target = destination(root, name)
        if not target.exists():
            complete = False
        elif (target.stat().st_size != expected["bytes"]
              or digest(target.read_bytes()) != expected["sha256"]):
            raise ValueError(f"Modified reference asset: {name}; move it aside before restoring")
    return complete


def install(root, manifest, data):
    validate_manifest(manifest)
    if len(data) != manifest["bytes"] or digest(data) != manifest["sha256"]:
        raise ValueError("Reference archive checksum or size mismatch")
    payloads = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            destination(root, member.name)
            expected = manifest["files"].get(member.name)
            if not member.isfile() or expected is None or member.name in payloads:
                raise ValueError(f"Unexpected archive member: {member.name}")
            if member.size != expected["bytes"]:
                raise ValueError(f"Asset size mismatch: {member.name}")
            payload = archive.extractfile(member).read(expected["bytes"] + 1)
            if len(payload) != expected["bytes"] or digest(payload) != expected["sha256"]:
                raise ValueError(f"Asset checksum mismatch: {member.name}")
            payloads[member.name] = payload
    if payloads.keys() != manifest["files"].keys():
        raise ValueError("Reference archive is incomplete")
    # Validate every byte and existing destination before writing any files.
    cached(root, manifest)
    for name, payload in payloads.items():
        target = destination(root, name)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(payload)
            temporary.chmod(0o644)
            os.replace(temporary, target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Destination checkout (default: this repository)")
    parser.add_argument("--archive", type=Path, help="Use a previously downloaded archive without network access")
    parser.add_argument("--check", action="store_true", help="Verify local images without downloading")
    args = parser.parse_args()
    root = args.root.resolve()
    manifest = json.loads(MANIFEST.read_text())
    if cached(root, manifest):
        print(f'Verified {len(manifest["files"])} cached anime reference assets; no download needed.')
        return
    if args.check:
        raise SystemExit("Reference assets are missing; run python3 scripts/anime/fetch-assets.py")
    if args.archive:
        with args.archive.open("rb") as handle:
            data = handle.read(manifest["bytes"] + 1)
    else:
        request = urllib.request.Request(manifest["url"], headers={"User-Agent": "yunipals-anime-reference-assets/v1"})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
            data = response.read(manifest["bytes"] + 1)
    install(root, manifest, data)
    print(f'Restored and verified {len(manifest["files"])} ignored anime reference assets.')


if __name__ == "__main__":
    main()
