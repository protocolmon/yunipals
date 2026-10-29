"""Deterministic sheet keying. Never trims a grid or invokes a provider."""
from pathlib import Path
import numpy as np
from PIL import Image


def key_sheet(source, destination, blend, cols, rows):
    if blend not in ("add", "alpha") or type(cols) is not int or type(rows) is not int or not 1 <= cols <= 4 or not 1 <= rows <= 4 or cols * rows not in (2, 4):
        raise ValueError("Invalid kit sheet grid")
    image = Image.open(source).convert("RGB")
    if image.width % cols or image.height % rows or max(image.size) > 4096:
        raise ValueError("The recorded grid must divide the sheet dimensions")
    pixels = np.asarray(image).astype(np.float32)
    peak = pixels.max(axis=2)
    if blend == "add":
        pixels[peak < 22] = 0
        keyed = Image.fromarray(pixels.astype(np.uint8), "RGB")
    else:
        alpha = np.clip((peak - 18) / 40, 0, 1) * 255
        keyed = Image.fromarray(np.dstack([pixels, alpha]).clip(0, 255).astype(np.uint8), "RGBA")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    keyed.save(destination, format="WEBP", lossless=True, method=6)
    return {"w": image.width, "h": image.height, "cols": cols, "rows": rows, "blend": blend}
