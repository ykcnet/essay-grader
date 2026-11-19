"""Generate app icon (PNG + ICO) for Essay Grader.

Two variants:
  full       - 128px and above: paper, rule lines, red check, traced red circle
  simplified - 96px and below:  no circle, thicker check, two lines, paper straighter

The red circle is replayed from tools/circle_path.json, which is traced from
ref.png by tools/trace_circle.py.

Usage:
  python tools/make_icon.py             # write final files into the project root
  python tools/make_icon.py --preview   # write into preview/ only
"""

import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
SIZE = 1024
SS = 4
M = SIZE * SS

NAVY = (31, 58, 95, 255)      # #1F3A5F
PAPER = (247, 243, 234, 255)  # #F7F3EA
LINE = (201, 194, 180, 255)   # #C9C2B4
RED = (214, 69, 61, 255)      # #D6453D


# ----------------------------------------------------------------- pen stroke
def _load_trace():
    p = HERE / "circle_path.json"
    if not p.exists():
        return None
    d = json.loads(p.read_text(encoding="utf-8"))
    return (
        np.array(d["points"], dtype=float),
        np.array(d["radius"], dtype=float),
        tuple(d["bbox"]),
    )


def _procedural_circle(base: Image.Image, cx, cy, width) -> None:
    """Fallback: hand-built loop, used only if circle_path.json is missing."""
    rx, ry, rot = width * 0.50, width * 0.47, math.radians(-40)
    d = ImageDraw.Draw(base)
    pts = []
    for i in range(700):
        t = math.radians(300 + 380 * i / 699)
        wob = 1 + 0.03 * math.sin(3 * t + 0.6)
        x, y = rx * wob * math.cos(t), ry * wob * math.sin(t)
        pts.append((cx + x * math.cos(rot) - y * math.sin(rot),
                    cy + x * math.sin(rot) + y * math.cos(rot)))
    d.line(pts, fill=RED, width=int(width * 0.075), joint="curve")


def hand_circle(base: Image.Image, cx: float, cy: float, width: float,
                stroke_scale: float = 1.0) -> None:
    """Replay the reference pen stroke, centred on (cx, cy) at the given width.

    stroke_scale fattens the ink without moving the path, so small icon sizes can
    keep the circle instead of losing it between pixels.
    """
    trace = _load_trace()
    if trace is None:
        _procedural_circle(base, cx, cy, width)
        return

    pts, rad, (x0, y0, x1, y1) = trace
    sw = x1 - x0 + 1
    s = width / sw

    # resample the centre line finely so stamping stays smooth at master scale
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    acc = np.r_[0.0, np.cumsum(seg)]
    n = 1500
    t = np.linspace(0.0, acc[-1], n)
    xs = np.interp(t, acc, pts[:, 0])
    ys = np.interp(t, acc, pts[:, 1])

    # smooth the measured pen radius: median first (kills the jitter that would
    # show up as scallops), then a short mean (keeps the pen's pressure bulge)
    k = 15
    padded = np.r_[np.repeat(rad[0], k // 2), rad, np.repeat(rad[-1], k // 2)]
    smooth = np.median(np.lib.stride_tricks.sliding_window_view(padded, k), axis=1)
    smooth = np.convolve(smooth, np.ones(9) / 9, "same")
    w = np.interp(t, acc, smooth * 2.0) * 1.03 * stroke_scale

    f = np.linspace(0.0, 1.0, n)
    w *= np.clip(0.22 + 0.78 * (f / 0.055), 0.0, 1.0)        # landing: thin flick
    w *= np.clip(0.35 + 0.65 * ((1 - f) / 0.055), 0.0, 1.0)  # lift-off: tucked end

    bxc, byc = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    d = ImageDraw.Draw(base)
    for x, y, ww in zip(xs, ys, w):
        px = cx + (x - bxc) * s
        py = cy + (y - byc) * s
        r = max(1.0, ww * s / 2.0)
        d.ellipse((px - r, py - r, px + r, py + r), fill=RED)


# --------------------------------------------------------------------- master
def build_master(simplified: bool = False, circle_scale: float = 1.0) -> Image.Image:
    base = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle((0, 0, M - 1, M - 1), radius=int(M * (0.20 if simplified else 0.22)), fill=NAVY)

    # paper sheet
    if simplified:
        pw, ph = int(M * 0.56), int(M * 0.70)
    else:
        pw, ph = int(M * 0.50), int(M * 0.64)

    paper = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    pd = ImageDraw.Draw(paper)
    pd.rounded_rectangle((0, 0, pw - 1, ph - 1), radius=int(M * 0.022), fill=PAPER)

    mx = int(pw * 0.13)
    lw = max(2, int(M * (0.014 if simplified else 0.011)))
    ratios = (0.34, 0.54) if simplified else (0.30, 0.46, 0.62)
    for i, ratio in enumerate(ratios):
        y = int(ph * ratio)
        last = i == len(ratios) - 1
        w = int((pw - 2 * mx) * (0.62 if last else 1.0))
        pd.rounded_rectangle((mx, y, mx + w, y + lw), radius=lw // 2, fill=LINE)

    paper = paper.rotate(-4 if simplified else -8, resample=Image.BICUBIC, expand=True)
    px = (M - paper.width) // 2
    py = (M - paper.height) // 2 - int(M * 0.02)
    base.alpha_composite(paper, (px, py))

    # red check
    d = ImageDraw.Draw(base)
    w = int(M * (0.072 if simplified else 0.055))
    if simplified:
        pts = [
            (int(M * 0.345), int(M * 0.615)),
            (int(M * 0.462), int(M * 0.735)),
            (int(M * 0.690), int(M * 0.430)),
        ]
    else:
        pts = [
            (int(M * 0.345), int(M * 0.625)),
            (int(M * 0.455), int(M * 0.745)),
            (int(M * 0.655), int(M * 0.475)),
        ]
    d.line(pts, fill=RED, width=w, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse((p[0] - w // 2, p[1] - w // 2, p[0] + w // 2, p[1] + w // 2), fill=RED)

    # traced red circle (drawn on every size that still has room for it)
    if not simplified:
        hand_circle(base, cx=M * 0.622, cy=M * 0.300, width=M * 0.224,
                    stroke_scale=circle_scale)

    return base.resize((SIZE, SIZE), Image.LANCZOS)


# ------------------------------------------------------------------------ ico
def _dib(img: Image.Image) -> bytes:
    """Encode an image as a 32-bit bottom-up DIB (as used inside .ico)."""
    img = img.convert("RGBA")
    w, h = img.size
    raw = img.tobytes("raw", "BGRA")
    stride = w * 4
    rows = [raw[y * stride:(y + 1) * stride] for y in range(h)]
    pixels = b"".join(reversed(rows))

    mask_stride = ((w + 31) // 32) * 4
    mask = b"\x00" * (mask_stride * h)

    header = struct.pack(
        "<IiiHHIIiiII",
        40,      # biSize
        w,       # biWidth
        h * 2,   # biHeight (image + mask)
        1,       # biPlanes
        32,      # biBitCount
        0,       # biCompression
        len(pixels) + len(mask),
        0, 0, 0, 0,
    )
    return header + pixels + mask


def write_ico(path: Path, entries: list[tuple[int, Image.Image]]) -> None:
    blobs = [_dib(img) for _, img in entries]
    count = len(entries)
    offset = 6 + 16 * count
    out = bytearray(struct.pack("<HHH", 0, 1, count))
    for (size, _), blob in zip(entries, blobs):
        w = 0 if size >= 256 else size
        out += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    for blob in blobs:
        out += blob
    path.write_bytes(bytes(out))


def _fit(img: Image.Image, size: int) -> Image.Image:
    """Downscale a 4096px master without the stair-stepping that a single
    LANCZOS pass produces at 32x reduction (prefilter first, then filter)."""
    return img.resize((size, size), Image.LANCZOS, reducing_gap=3.0)


# ----------------------------------------------------------------------- main
# The traced circle is a 1px-thin line at small sizes, and a curve thinner than
# ~2.5px stair-steps however well it is filtered. So the ink is fattened (the
# path never moves) per size tier, which is standard optical compensation.
TIERS = (
    (256, 1.0),   # 256, 192: as traced
    (128, 1.35),  # 128: 2.4px -> 3.2px
    (96, 1.70),   # 96
    (64, 2.00),   # 72, 64
    (48, 2.20),   # 48
)
FULL_MIN = 48     # below this the circle is dropped entirely


def variant_for(size: int, cache: dict) -> Image.Image:
    if size < FULL_MIN:
        key = ("simple",)
        if key not in cache:
            cache[key] = build_master(True)
        return cache[key]
    for limit, scale in TIERS:
        if size >= limit:
            key = ("full", scale)
            if key not in cache:
                cache[key] = build_master(False, circle_scale=scale)
            return cache[key]
    raise AssertionError(size)


def main() -> None:
    preview = "--preview" in sys.argv
    target = OUT / "preview" if preview else OUT
    target.mkdir(parents=True, exist_ok=True)

    cache: dict = {}
    full = variant_for(256, cache)

    full.save(target / "icon.png")
    for size in (512, 256, 192, 128, 96, 72, 64, 48, 32, 16):
        _fit(variant_for(size, cache), size).save(target / f"icon-{size}.png")

    ico_sizes = [256, 128, 96, 64, 48, 32, 24, 16]
    entries = [
        (s, _fit(variant_for(s, cache), s))
        for s in ico_sizes
    ]
    write_ico(target / "app.ico", entries)

    # Android launcher icons
    android = target / "assets" / "android"
    for folder, size in (
        ("mipmap-mdpi", 48),
        ("mipmap-hdpi", 72),
        ("mipmap-xhdpi", 96),
        ("mipmap-xxhdpi", 144),
        ("mipmap-xxxhdpi", 192),
    ):
        d = android / folder
        d.mkdir(parents=True, exist_ok=True)
        _fit(variant_for(size, cache), size).save(d / "ic_launcher.png")

    # preview sheet: every size at actual pixels
    sheet_sizes = [256, 128, 96, 64, 48, 32, 16]
    gap, top = 24, 24
    sheet_w = sum(sheet_sizes) + gap * (len(sheet_sizes) + 1)
    sheet_h = 256 + top * 2
    sheet = Image.new("RGB", (sheet_w, sheet_h), (238, 236, 231))
    x = gap
    for s in sheet_sizes:
        thumb = _fit(variant_for(s, cache), s)
        sheet.paste(thumb, (x, top), thumb)
        x += s + gap
    sheet.save(target / "icon-preview.png")

    print(f"target: {target}")
    for p in sorted(target.glob("*.png")) + [target / "app.ico"]:
        print(f"  {p.name:20s} {p.stat().st_size:>8,} bytes")


if __name__ == "__main__":
    main()
