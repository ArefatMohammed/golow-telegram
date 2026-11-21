"""QR codes as SVG for the overlay's bid-now banner."""

import io
from functools import lru_cache

import segno


@lru_cache(maxsize=256)
def qr_svg(url: str) -> bytes:
    out = io.BytesIO()
    # Medium error correction survives a slightly blurry stream; a 2-module quiet zone sits on the white tile.
    segno.make(url, error="m").save(out, kind="svg", scale=10, border=2, dark="#0b0b0f", light="#ffffff", xmldecl=False, svgns=True)
    return out.getvalue()
