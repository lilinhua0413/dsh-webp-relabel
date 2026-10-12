#!/usr/bin/env python3
"""Create an RGBA (alpha) PNG containing a word, so DSH normalizes it to WebP.

Usage: python3 make-alpha-image.py [output.png] [WORD]
"""
import sys

from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "alpha-word.png"
WORD = sys.argv[2] if len(sys.argv) > 2 else "BANANA"

img = Image.new("RGBA", (440, 180), (255, 255, 255, 180))  # alpha != 255 -> hasAlpha
d = ImageDraw.Draw(img)
d.rectangle([4, 4, 435, 175], outline=(200, 30, 30, 255), width=6)

tmp = Image.new("RGB", (150, 44), (255, 255, 255))
ImageDraw.Draw(tmp).text((10, 14), WORD, fill=(0, 0, 0))
img.paste(tmp.resize((400, 110), Image.NEAREST), (20, 35))

img.save(out)
print("saved", out, img.mode, img.size)
