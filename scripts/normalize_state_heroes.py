"""Normalise the state hero images to ONE canvas size.

The source art arrives at whatever aspect the state happens to be — IL 0.80
(tall), MO 1.12 (square-ish), IA 1.55 (wide). Dropped straight into an
email that makes the message a different height for every reader, and the
layout visibly jumps between states.

Fix: one fixed canvas (3:2, the shape that reads best in an inbox). The
state is scaled to FIT inside it, so nothing is ever cropped off, and the
leftover space is filled with a blurred, zoomed copy of that same image.
The backdrop is therefore the state's own terrain — it reads as depth of
field rather than as letterboxing, and no solid bar appears.
"""
import os
from PIL import Image, ImageFilter

TARGET_W, TARGET_H = 1122, 748          # 3:2 at 2x for a 561px email column
SOURCES = {
    "il": "GG_IL_MAP_IMG.png",
    "ia": "GG_IA_MAP_IMG.png",
    "mo": "GG_MO_MAP_IMG.png",
}
DL = "/Users/jaredmurphy/Downloads"
OUT = "public/email"

def normalize(src_path, out_stem):
    im = Image.open(src_path).convert("RGB")

    # Backdrop: cover the canvas, then blur hard so it never competes with
    # the subject.
    scale = max(TARGET_W / im.width, TARGET_H / im.height) * 1.08
    bw, bh = int(im.width * scale), int(im.height * scale)
    bg = im.resize((bw, bh), Image.LANCZOS).filter(ImageFilter.GaussianBlur(22))
    bg = bg.crop(((bw - TARGET_W) // 2, (bh - TARGET_H) // 2,
                  (bw - TARGET_W) // 2 + TARGET_W,
                  (bh - TARGET_H) // 2 + TARGET_H))

    # Subject: fit entirely inside, with a small margin so the state never
    # touches the edge.
    fit = min(TARGET_W / im.width, TARGET_H / im.height) * 0.94
    fw, fh = int(im.width * fit), int(im.height * fit)
    fg = im.resize((fw, fh), Image.LANCZOS)

    # FEATHERED EDGE. Pasting the sharp copy straight onto the blur leaves a
    # hard rectangle — it reads as a pasted box rather than depth of field,
    # and the seam is obvious where the two scales don't line up. A mask
    # that is solid in the middle and falls off over ~FEATHER px at the
    # border dissolves that edge into the backdrop.
    FEATHER = 46
    mask = Image.new("L", (fw, fh), 0)
    inner = Image.new("L", (max(1, fw - 2 * FEATHER), max(1, fh - 2 * FEATHER)), 255)
    mask.paste(inner, (FEATHER, FEATHER))
    mask = mask.filter(ImageFilter.GaussianBlur(FEATHER / 2.2))
    bg.paste(fg, ((TARGET_W - fw) // 2, (TARGET_H - fh) // 2), mask)

    p2 = f"{OUT}/{out_stem}-terrain-hero.jpg"
    bg.save(p2, "JPEG", quality=82, optimize=True, progressive=True)
    p1 = f"{OUT}/{out_stem}-terrain-hero@1x.jpg"
    bg.resize((TARGET_W // 2, TARGET_H // 2), Image.LANCZOS).save(
        p1, "JPEG", quality=84, optimize=True, progressive=True)
    print(f"{out_stem}: {im.size} -> {bg.size}  "
          f"2x {os.path.getsize(p2)//1024}KB  1x {os.path.getsize(p1)//1024}KB")

for stem, fname in SOURCES.items():
    normalize(os.path.join(DL, fname), stem)
