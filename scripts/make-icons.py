# Builds the SN favicon set (white monogram on black) from the 500x500 logo.
# Usage: python3 scripts/make-icons.py <logo.png> public/icons
import sys
from PIL import Image, ImageOps
src, out = sys.argv[1], sys.argv[2]
L = Image.open(src).convert('L')
mask = ImageOps.invert(L)                      # monogram -> white
bbox = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
mono = mask.crop(bbox)
def icon(S, ratio=0.69):
    big = S * 4                                 # render large, then downsample for clean edges
    h = int(big * ratio); w = round(mono.width * h / mono.height)
    m = mono.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGB', (big, big), (0, 0, 0))
    white = Image.new('RGB', (w, h), (255, 255, 255))
    canvas.paste(white, ((big - w) // 2, (big - h) // 2), m)
    return canvas.resize((S, S), Image.LANCZOS)
icon(512).save(f'{out}/icon-512.png', optimize=True)
icon(192).save(f'{out}/icon-192.png', optimize=True)
icon(180).save(f'{out}/apple-touch-icon.png', optimize=True)
icon(32).save(f'{out}/favicon-32.png', optimize=True)
# RGBA PNG frames: Next.js (Turbopack) rejects ICO files with RGB frames
icon(256).convert('RGBA').save(f'{out}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], bitmap_format='png')
print('bbox', bbox)
