"""Validate every image in a local or published gallery, including preview URLs."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import getpass
from io import BytesIO
import json
from pathlib import Path
import urllib.error
import urllib.request

from PIL import Image

from art_lab import public_asset_paths


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    location = parser.add_mutually_exclusive_group(required=True)
    location.add_argument("--directory", type=Path)
    location.add_argument("--url")
    parser.add_argument("--auth-stdin", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    headers = {"Cache-Control": "no-cache"}
    if args.auth_stdin:
        headers["OAI-Sites-Authorization"] = "Bearer " + getpass.getpass("Existing Sites authorization (hidden): ")

    def fetch(name):
        if args.directory:
            return (args.directory / name).read_bytes()
        request = urllib.request.Request(args.url.rstrip("/") + "/" + name, headers=headers)
        # Never forward the private Site's authorization to a redirect target.
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            content = response.read(8 * 1024 * 1024 + 1)
        if len(content) > 8 * 1024 * 1024:
            raise ValueError("Asset exceeds the validation download limit")
        return content

    def check(name):
        try:
            content = fetch(name)
            with Image.open(BytesIO(content)) as picture:
                dimensions = picture.size
                file_format = picture.format
                picture.verify()
            return {"asset": name, "ok": True, "format": file_format, "width": dimensions[0], "height": dimensions[1]}
        except (OSError, ValueError, urllib.error.URLError) as error:
            return {"asset": name, "ok": False, "error": str(error)}

    try:
        data = json.loads(fetch("data.json"))
        paths = public_asset_paths(data)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(check, paths))
        report = {"ok": all(item["ok"] for item in results), "imagesChecked": len(results), "results": results}
    except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
        report = {"ok": False, "error": str(error)}
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    failures = [item for item in report.get("results", []) if not item["ok"]]
    print(json.dumps({key: value for key, value in report.items() if key != "results"} | {"failures": failures}))
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
