"""Trace the hand-drawn red circle in ref.png into a centre-line path.

Pipeline:
  1. keep the red ink from ref.png (drop paper, watermark, jpeg noise)
  2. thin the ink blob to a 1px skeleton (Zhang-Suen)
  3. walk the skeleton from its free end, always continuing straight at crossings
  4. resample by arc length, smooth lightly, measure local pen width

Writes tools/circle_path.json and preview/trace-debug.png.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "ref.png"
OUT_JSON = Path(__file__).resolve().parent / "circle_path.json"
OUT_DEBUG = ROOT / "preview" / "trace-debug.png"


# ---------------------------------------------------------------- ink mask
def red_mask(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB")).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    m = (r > 105) & (r - g > 40) & (r - b > 30)
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    if n > 1:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (int(np.argmax(sizes)) + 1)
    return m


# ------------------------------------------------------------- thinning
def _neighbours(p: np.ndarray) -> list[np.ndarray]:
    """P2..P9 clockwise starting at north, Zhang-Suen numbering."""
    y, x = p
    return [
        np.array([y - 1, x]),      # P2 N
        np.array([y - 1, x + 1]),  # P3 NE
        np.array([y, x + 1]),      # P4 E
        np.array([y + 1, x + 1]),  # P5 SE
        np.array([y + 1, x]),      # P6 S
        np.array([y + 1, x - 1]),  # P7 SW
        np.array([y, x - 1]),      # P8 W
        np.array([y - 1, x - 1]),  # P9 NW
    ]


def _thin_step(img: np.ndarray, phase: int) -> np.ndarray:
    p = np.pad(img, 1)
    n = [
        p[0:-2, 1:-1], p[0:-2, 2:], p[1:-1, 2:], p[2:, 2:],
        p[2:, 1:-1], p[2:, 0:-2], p[1:-1, 0:-2], p[0:-2, 0:-2],
    ]
    # B: number of set neighbours
    b = sum(x.astype(np.uint8) for x in n)
    # A: number of 0->1 transitions in the cycle P2,P3,...,P9,P2
    seq = n + [n[0]]
    a = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
    if phase == 0:
        cond = (
            (img == 1) & (b >= 2) & (b <= 6) & (a == 1)
            & ((n[0] == 0) | (n[2] == 0) | (n[4] == 0))
            & ((n[2] == 0) | (n[4] == 0) | (n[6] == 0))
        )
    else:
        cond = (
            (img == 1) & (b >= 2) & (b <= 6) & (a == 1)
            & ((n[0] == 0) | (n[2] == 0) | (n[6] == 0))
            & ((n[0] == 0) | (n[4] == 0) | (n[6] == 0))
        )
    out = img.copy()
    out[cond] = 0
    return out


def skeletonize(mask: np.ndarray, max_iter: int = 200) -> np.ndarray:
    img = mask.astype(np.uint8)
    for i in range(max_iter):
        before = img.sum()
        img = _thin_step(img, 0)
        img = _thin_step(img, 1)
        if img.sum() == before:
            break
    return img.astype(bool)


# ------------------------------------------------------------- graph walk
def degree_map(skel: np.ndarray) -> np.ndarray:
    k = np.ones((3, 3))
    k[1, 1] = 0
    return ndi.convolve(skel.astype(np.uint8), k, mode="constant")


def walk(skel: np.ndarray) -> list[tuple[int, int]]:
    """Follow the skeleton from a free end, preferring straight continuation."""
    deg = degree_map(skel)
    pts = np.argwhere(skel)
    ends = [tuple(p) for p in np.argwhere(skel & (deg == 1))]
    if not ends:
        ends = [tuple(p) for p in np.argwhere(skel & (deg == 2))[:1]]

    start = min(ends, key=lambda p: p[1])  # left-most free end
    path = [start]
    visited = {start}
    prev_dir = np.array([0.0, 1.0])        # (dy, dx)
    cur = start

    for _ in range(skel.sum() * 3):
        cands = [
            nb for nb in _neighbours(np.array(cur))
            if 0 <= nb[0] < skel.shape[0] and 0 <= nb[1] < skel.shape[1]
            and skel[nb[0], nb[1]] and tuple(nb) not in visited
        ]
        if not cands:
            break
        if len(cands) == 1:
            nxt = cands[0]
        else:
            scores = []
            for nb in cands:
                d = np.array([nb[0] - cur[0], nb[1] - cur[1]], dtype=float)
                d /= np.linalg.norm(d)
                scores.append(float(d @ prev_dir))
            nxt = cands[int(np.argmax(scores))]
        step = np.array([nxt[0] - cur[0], nxt[1] - cur[1]], dtype=float)
        step /= np.linalg.norm(step)
        prev_dir = 0.6 * prev_dir + 0.4 * step
        prev_dir /= np.linalg.norm(prev_dir)
        cur = (int(nxt[0]), int(nxt[1]))
        visited.add(cur)
        path.append(cur)
    return path


# --------------------------------------------------------------- reshape
def resample(pts: np.ndarray, n: int) -> np.ndarray:
    d = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n)
    return np.c_[np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])]


def smooth(pts: np.ndarray, window: int = 9) -> np.ndarray:
    if window < 3:
        return pts
    pad = window // 2
    padded = np.r_[np.repeat(pts[:1], pad, 0), pts, np.repeat(pts[-1:], pad, 0)]
    k = np.ones(window) / window
    return np.c_[np.convolve(padded[:, 0], k, "same"), np.convolve(padded[:, 1], k, "same")][pad:-pad]


def main() -> None:
    img = Image.open(REF)
    mask = red_mask(img)
    # Drop hairlines: the export carries a faint 1px red seam that is connected
    # to the stroke, and thinning would otherwise follow it instead of the pen.
    mask = ndi.binary_opening(mask, np.ones((5, 5)))
    mask = ndi.binary_closing(mask, np.ones((3, 3)))
    mask = ndi.binary_fill_holes(mask) | mask

    skel = skeletonize(mask)
    path = np.array(walk(skel), dtype=float)          # (y, x)
    path = smooth(resample(path, 480), 7)

    dist = ndi.distance_transform_edt(mask)
    radius = np.array([dist[int(round(y)), int(round(x))] for y, x in path])

    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()

    data = {
        "src": REF.name,
        "bbox": [int(x0), int(y0), int(x1), int(y1)],
        "points": [[round(float(x), 3), round(float(y), 3)] for y, x in path],
        "radius": [round(float(v), 3) for v in radius],
    }
    OUT_JSON.write_text(json.dumps(data), encoding="utf-8")

    # debug sheet: original crop | ink | skeleton + path
    crop = img.convert("RGB").crop((x0, y0, x1 + 1, y1 + 1))
    ink = Image.fromarray(np.where(mask[y0:y1 + 1, x0:x1 + 1], 0, 255).astype(np.uint8)).convert("RGB")
    view = np.array(crop).copy()
    view[skel[y0:y1 + 1, x0:x1 + 1]] = (0, 90, 200)
    for y, x in path:
        yy, xx = int(round(y - y0)), int(round(x - x0))
        view[max(0, yy - 1):yy + 2, max(0, xx - 1):xx + 2] = (0, 160, 0)
    traced = Image.fromarray(view)

    w, h = crop.size
    sheet = Image.new("RGB", (w * 3 + 24, h), (255, 255, 255))
    for i, im in enumerate((crop, ink, traced)):
        sheet.paste(im, (i * (w + 12), 0))

    OUT_DEBUG.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DEBUG)

    print(f"path points   : {len(path)}")
    print(f"bounding box  : {w} x {h}")
    print(f"pen radius    : median {np.median(radius):.2f}px  min {radius.min():.2f}  max {radius.max():.2f}")
    print(f"thin points   : {(radius < 2.5).sum()} of {len(radius)}")
    print(f"start / end   : ({path[0][1]:.0f},{path[0][0]:.0f}) -> ({path[-1][1]:.0f},{path[-1][0]:.0f})")
    print(f"wrote {OUT_JSON}")
    print(f"wrote {OUT_DEBUG}")


if __name__ == "__main__":
    main()
