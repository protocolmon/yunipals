#!/usr/bin/env python3
"""Verify published island art; download exact checksum-bound files only with --download.

No API keys or paid generation. The complete 898-image catalog is about 1.85 GB.
Use --token-id to prepare individual islands, or omit it for the full catalog.
"""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public'
MAX_BYTES = 32 * 1024 * 1024


def checksum(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-id', action='append', help='Repeat to select several islands')
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    ids = args.token_id or [p.stem for p in (PUBLIC / 'metadata').glob('*.json')]
    assert ids and all(i.isdecimal() and 0 < int(i) < 65536 for i in ids), 'Invalid token ID'
    images = PUBLIC / 'images'
    assert not images.is_symlink() and images.resolve().is_relative_to(ROOT), 'Image directory must be inside this checkout'
    missing, verified, downloaded = [], 0, 0
    for token_id in sorted(set(ids), key=int):
        meta = json.loads((PUBLIC / 'metadata' / f'{token_id}.json').read_text())
        expected = meta['properties']['image_sha256']
        assert len(expected) == 64 and all(c in '0123456789abcdef' for c in expected)
        url = meta['image']
        assert url == f'https://assets.yunipals.com/islands/v2/images/{token_id}.png', 'Unexpected art URL'
        target = images / f'{token_id}.png'
        assert not target.is_symlink(), 'Image file cannot be a symlink'
        if target.is_file() and checksum(target) == expected:
            verified += 1
            continue
        if not args.download:
            missing.append(token_id)
            continue
        images.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; YunipalsAssetVerifier/1.0; +https://www.yunipals.com)'})
            with urlopen(request, timeout=30) as response, tempfile.NamedTemporaryFile(dir=images, delete=False) as output:
                temporary = Path(output.name)
                assert urlparse(response.url).scheme == 'https', 'HTTPS required'
                total = 0
                while chunk := response.read(65536):
                    total += len(chunk)
                    assert total <= MAX_BYTES, 'Image exceeds download bound'
                    output.write(chunk)
            assert checksum(temporary) == expected, 'Published image checksum differs'
            temporary.replace(target)
            downloaded += 1
            verified += 1
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    print(json.dumps({'verified': verified, 'downloaded': downloaded, 'missingOrInvalid': len(missing), 'downloadEnabled': args.download}))
    return 1 if missing else 0


if __name__ == '__main__':
    raise SystemExit(main())
