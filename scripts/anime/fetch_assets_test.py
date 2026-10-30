import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("fetch_assets", Path(__file__).with_name("fetch-assets.py"))
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
NAME = "apps/yunipals-anime-engine/fixtures/assets/cedar-idle.webp"


def bundle(entries=None):
    entries = entries if entries is not None else [(NAME, b"reference image", tarfile.REGTYPE)]
    buffer = io.BytesIO()
    files = {}
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, data, kind in entries:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = len(data)
            if kind == tarfile.SYMTYPE:
                member.linkname = "/tmp/outside"
            archive.addfile(member, io.BytesIO(data))
            files[name] = {"bytes": len(data), "sha256": assets.digest(data)}
    data = buffer.getvalue()
    checksum = hashlib.sha256(data).hexdigest()
    return {
        "version": "anime-reference-assets/v1", "sha256": checksum,
        "url": f"https://assets-anime.yunipals.com/tooling/anime-reference-assets/{checksum}.tar.gz",
        "bytes": len(data), "files": files
    }, data


class ReferenceAssetsTest(unittest.TestCase):
    def test_restore_and_reuse_verified_cache_offline(self):
        manifest, data = bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertFalse(assets.cached(root, manifest))
            assets.install(root, manifest, data)
            self.assertTrue(assets.cached(root, manifest))
            assets.install(root, manifest, data)
            self.assertEqual((root / NAME).read_bytes(), b"reference image")

    def test_reject_modified_archive_and_image_before_any_write(self):
        manifest, data = bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "archive checksum"):
                assets.install(root, manifest, data + b"changed")
            manifest["files"][NAME]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "Asset checksum"):
                assets.install(root, manifest, data)
            self.assertEqual(list(root.iterdir()), [])

    def test_reject_paths_links_and_duplicate_members(self):
        for entries in [
            [("apps/yunipals-anime-engine/fixtures/assets/../../escape.webp", b"x", tarfile.REGTYPE)],
            [(NAME, b"x", tarfile.SYMTYPE)],
            [(NAME, b"x", tarfile.REGTYPE), (NAME, b"x", tarfile.REGTYPE)]
        ]:
            manifest, data = bundle(entries)
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaises(ValueError):
                    assets.install(root, manifest, data)
                self.assertEqual(list(root.iterdir()), [])

    def test_reject_missing_member_and_modified_local_copy(self):
        manifest, data = bundle()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            extra = "apps/yunipals-anime-engine/fixtures/assets/extra.webp"
            manifest["files"][extra] = manifest["files"][NAME]
            with self.assertRaisesRegex(ValueError, "incomplete"):
                assets.install(root, manifest, data)
            del manifest["files"][extra]
            assets.install(root, manifest, data)
            (root / NAME).write_bytes(b"local work")
            with self.assertRaisesRegex(ValueError, "Modified reference asset"):
                assets.install(root, manifest, data)
            self.assertEqual((root / NAME).read_bytes(), b"local work")

    def test_reject_existing_destination_symlink(self):
        manifest, data = bundle()
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            (root / "apps").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink"):
                assets.install(root, manifest, data)
            self.assertEqual(list(Path(outside).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
