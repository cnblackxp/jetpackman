"""Cuts the Jetpack Man pixel-art frames out of the sprite sheet.

Usage: python scripts/extract-sprites.py assets/sprites/jetpackman-sheet.png

The sheet is a grid of 192x312 cells on a solid dark background. The top row shows him wearing
the jetpack (used for flying). For each frame this script:
  1. flood-fills the background from the cell edges and makes it transparent (dark pixels inside
     the character are kept, because they aren't connected to the edges),
  2. crops every frame to one shared box so the animation stays aligned,
  3. resamples to 2x the in-game height (the game draws it at half size, sharp on hi-DPI screens).
Output: assets/sprites/jetpackman-fly-<n>.png
"""
import os
import sys
from collections import deque

from PIL import Image

CELL_W, CELL_H = 192, 312
ROW = 0                 # top row: jetpack on his back
FRAMES = 4              # the 5th cell of the top row is empty
INSET = 3               # skip the grid lines around each cell
TOLERANCE = 18          # how close to the background colour counts as background
TARGET_H = 92           # px: 2x the classic character's on-screen height (~46 px)


def close(a, b, tol=TOLERANCE):
    return all(abs(x - y) <= tol for x, y in zip(a[:3], b[:3]))


def clear_background(cell):
    w, h = cell.size
    px = cell.load()
    bg = px[2, 2]
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        if not close(px[x, y], bg):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return cell


def main(sheet_path):
    sheet = Image.open(sheet_path).convert('RGBA')
    out_dir = os.path.dirname(sheet_path)
    cells = []
    for i in range(FRAMES):
        box = (i * CELL_W + INSET, ROW * CELL_H + INSET, (i + 1) * CELL_W - INSET, (ROW + 1) * CELL_H - INSET)
        cells.append(clear_background(sheet.crop(box)))

    # One shared bounding box for all frames
    boxes = [c.getbbox() for c in cells]
    union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    scale = TARGET_H / (union[3] - union[1])
    size = (round((union[2] - union[0]) * scale), TARGET_H)
    for i, c in enumerate(cells):
        frame = c.crop(union).resize(size, Image.LANCZOS)
        path = os.path.join(out_dir, f'jetpackman-fly-{i}.png')
        frame.save(path)
        print(f'{path}  {frame.size[0]}x{frame.size[1]}')
    print(f'shared box {union}, scale {scale:.3f}')


if __name__ == '__main__':
    main(sys.argv[1])
