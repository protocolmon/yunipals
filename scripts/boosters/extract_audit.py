"""Extract and verify a Yunipals plain-text audit package. No network or execution."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys

BEGIN = b"YUNIPALS_AUDIT_FILE_V1\n"
END = b"\nYUNIPALS_AUDIT_FILE_END_V1\n"


def extract(package, output):
    data = Path(package).read_bytes()
    files = {}
    position = 0
    while True:
        start = data.find(BEGIN, position)
        if start < 0:
            break
        line_end = data.index(b"\n", start + len(BEGIN))
        meta = json.loads(data[start + len(BEGIN):line_end])
        relative = PurePosixPath(meta["path"])
        if relative.is_absolute() or ".." in relative.parts or "\\" in meta["path"]:
            raise ValueError("Unsafe path in package")
        if meta["path"] in files or meta["bytes"] < 0:
            raise ValueError("Duplicate file or invalid length")
        begin = line_end + 1
        end = begin + meta["bytes"]
        contents = data[begin:end]
        if data[end:end + len(END)] != END:
            raise ValueError("Truncated file: " + meta["path"])
        if hashlib.sha256(contents).hexdigest() != meta["sha256"]:
            raise ValueError("Checksum mismatch: " + meta["path"])
        files[meta["path"]] = contents
        position = end + len(END)
    if not files or "audit/manifest.json" not in files:
        raise ValueError("No complete package manifest found")
    manifest = json.loads(files["audit/manifest.json"])
    expected = {entry["path"]: entry for entry in manifest["files"]}
    if set(expected) != set(files) - {"audit/manifest.json"}:
        raise ValueError("File list does not match manifest")
    for name, meta in expected.items():
        if len(files[name]) != meta["bytes"] or hashlib.sha256(files[name]).hexdigest() != meta["sha256"]:
            raise ValueError("Manifest mismatch: " + name)
    output = Path(output).resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Choose an empty destination; existing files are never replaced")
    output.mkdir(parents=True, exist_ok=True)
    for name, contents in files.items():
        destination = output.joinpath(*PurePosixPath(name).parts).resolve()
        destination.relative_to(output)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)
    return {"output": str(output), "files": len(files), "sourceSnapshotSha256": manifest["sourceSnapshotSha256"]}


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: python3 extract-audit.py PACKAGE.txt [EMPTY_DIRECTORY]")
    print(json.dumps(extract(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else "yunipals-audit-source"), indent=2))
