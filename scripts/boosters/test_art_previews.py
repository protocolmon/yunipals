"""Check source binding, transparency and repeatable thumbnail publication."""

from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from art_previews import backfill, digest, publish_preview


class ArtPreviewTests(unittest.TestCase):
    def test_preview_keeps_transparency_and_is_immutable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = Image.new("RGBA", (1024, 1536), (0, 0, 0, 0))
            ImageDraw.Draw(image).rectangle((100, 100, 900, 1400), fill="purple")
            source = root / "original.png"
            image.save(source)
            original = source.read_bytes()
            sha = digest(original)
            first = publish_preview(root, source, sha)
            self.assertEqual(first, publish_preview(root, source, sha))
            self.assertEqual(source.read_bytes(), original)
            preview = root / "previews/v1" / f"{sha}.webp"
            with Image.open(preview) as thumbnail:
                self.assertEqual(thumbnail.size, (520, 780))
                self.assertEqual(thumbnail.getpixel((0, 0))[3], 0)
            preview.write_bytes(b"corrupted")
            with self.assertRaises((ValueError, OSError)):
                publish_preview(root, source, sha)

    def test_wrong_source_fingerprint_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "original.png"
            Image.new("RGB", (16, 24)).save(source)
            with self.assertRaisesRegex(ValueError, "Source artwork fingerprint"):
                publish_preview(root, source, "a" * 64)
            self.assertFalse((root / "previews").exists())

    def test_backfill_deduplicates_shared_images_and_leaves_metadata_intact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = BytesIO()
            Image.new("RGBA", (16, 24), (100, 50, 200, 255)).save(output, format="PNG")
            original = output.getvalue()
            sha = digest(original)
            (root / "assets").mkdir()
            (root / "assets" / f"{sha}.png").write_bytes(original)
            folder = root / "catalogs/demo/variants"
            folder.mkdir(parents=True)
            metadata = json.dumps({"image": f"https://example.test/v1/boosters/art-assets/{sha}.png", "yunipals": {"status": "ready", "artworkSha256": sha}})
            for rank in (1, 2):
                (folder / f"{rank}.json").write_text(metadata)
            result = backfill(root)
            self.assertEqual(result["images"], 1)
            self.assertEqual((folder / "1.json").read_text(), metadata)
            with Image.open(root / "previews/v1" / f"{sha}.webp") as image:
                self.assertEqual(image.size, (16, 24))
            self.assertEqual(result, backfill(root))


if __name__ == "__main__":
    unittest.main()
