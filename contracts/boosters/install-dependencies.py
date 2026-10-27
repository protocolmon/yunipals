#!/usr/bin/env python3
"""Install exact upstream sources; no npm lifecycle scripts or Git submodule mutation."""
import base64
import hashlib
import io
import pathlib
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
PACKAGES = [
    ("chainlink", "https://registry.npmjs.org/@chainlink/contracts/-/contracts-1.4.0.tgz",
     "SpNCJ0TPOI6pa2l702Wk4WIP8ccw5ARcRP1E/ZTqaFffXNoZeF03WhsVL8f3l3OTRFA9Z40O5KcZzmJmZQkoFA=="),
    ("openzeppelin-upgradeable", "https://registry.npmjs.org/@openzeppelin/contracts-upgradeable/-/contracts-upgradeable-5.4.0.tgz",
     "STJKyDzUcYuB35Zub1JpWW58JxvrFFVgQ+Ykdr8A9PGXgtq/obF5uoh07k2XmFyPxfnZdPdBdhkJ/n2YxJ87HQ=="),
    ("openzeppelin", "https://registry.npmjs.org/@openzeppelin/contracts/-/contracts-5.4.0.tgz",
     "eCYgWnLg6WO+X52I16TZt8uEjbtdkgLC0SUX/xnAksjjrQI4Xfn4iBRoI5j55dmlOhDv1Y7BoR3cU7e3WWhC6A=="),
]

def extract(data, name):
    dest = ROOT / "lib" / name
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            parts = member.name.split("/", 1)
            if len(parts) != 2 or not parts[1]:
                continue
            member.name = parts[1]
            archive.extract(member, dest, filter="data")

for name, url, digest in PACKAGES:
    data = urllib.request.urlopen(url, timeout=90).read()
    if base64.b64encode(hashlib.sha512(data).digest()).decode() != digest:
        raise RuntimeError(f"Integrity check failed: {name}")
    extract(data, name)
    print(name, "verified")

# forge-std v1.9.7, immutable upstream Git commit.
commit = "77041d2ce690e692d6e03cc812b57d1ddaa4d505"
data = urllib.request.urlopen(
    f"https://api.github.com/repos/foundry-rs/forge-std/tarball/{commit}", timeout=90
).read()
extract(data, "forge-std")
print("forge-std", commit)
