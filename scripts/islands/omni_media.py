"""Identify reference image bytes without trusting a filename extension."""


def image_mime_type(raw):
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("Unsupported reference image signature; expected JPEG, PNG or WebP")
