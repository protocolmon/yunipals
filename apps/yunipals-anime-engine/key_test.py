"""Regression coverage for preserving green fighter features during keying."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw


class SpriteKeyTest(unittest.TestCase):
    def key(self, image, name="idle"):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw"
            raw.mkdir()
            image.save(raw / f"{name}.png")
            subprocess.run(
                [sys.executable, str(Path(__file__).with_name("key.py")),
                 str(raw), str(root / "keyed")],
                check=True, capture_output=True
            )
            result = Image.open(root / "keyed" / f"{name}.png").copy()
            manifest = json.loads((root / "keyed/sprites.json").read_text())
            self.assertEqual((manifest[name]["w"], manifest[name]["h"]), result.size)
            return result

    def test_green_details_inside_outline_remain_opaque_and_unchanged(self):
        image = Image.new("RGB", (40, 40), "#00ff00")
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 29, 29), fill="#202020")
        draw.rectangle((12, 12, 27, 27), fill="#20b040")
        image.putpixel((20, 20), (24, 220, 64))
        result = self.key(image)
        self.assertEqual(result.size, (20, 20))
        self.assertEqual(result.getpixel((5, 5)), (32, 176, 64, 255))
        self.assertEqual(result.getpixel((10, 10)), (24, 220, 64, 255))

    def test_reserved_chroma_color_in_enclosed_gap_is_removed(self):
        image = Image.new("RGB", (40, 40), "#00ff00")
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 29, 29), fill="#202020")
        draw.rectangle((15, 15, 24, 24), fill="#00ff00")
        result = self.key(image)
        self.assertEqual(result.getpixel((10, 10))[3], 0)
        self.assertEqual(result.getpixel((0, 0)), (32, 32, 32, 255))

    def test_background_between_legs_is_removed_without_desaturating_body(self):
        image = Image.new("RGB", (40, 40), "#00ff00")
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 29, 19), fill="#607050")
        draw.rectangle((10, 20, 14, 29), fill="#202020")
        draw.rectangle((25, 20, 29, 29), fill="#202020")
        result = self.key(image)
        self.assertEqual(result.getpixel((8, 5)), (96, 112, 80, 255))
        self.assertEqual(result.getpixel((8, 15))[3], 0)

    def test_cutin_keeps_full_frame_and_green_colors(self):
        image = Image.new("RGB", (40, 20), "#00ff00")
        result = self.key(image, "cutin")
        self.assertEqual(result.size, image.size)
        self.assertEqual(result.getpixel((0, 0)), (0, 255, 0, 255))


if __name__ == "__main__":
    unittest.main()
