#!/usr/bin/env python3
"""VLXR (VLXR) logo — mark is the real app icon (vlxr.ico), wordmark is
"VLXR" in Segoe UI Semibold outlines (fontTools), "XR" in accent blue.
Emits SVG masters + transparent PNGs at 450x76 / 225x38 / 113x19 + favicon."""
import base64
import io

import resvg_py
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from PIL import Image

FONT = r"C:\Windows\Fonts\segoeuib.ttf"
ICON = r"F:\AI-Projects\VLXR\vlxr-icon.png"
OUT = r"F:\AI-Projects\VIEWLAB-XR\brand"
INK = "#ECEDF1"        # VLXR Streamer theme text
INK_DARK = "#17191C"   # for light backgrounds
ACCENT = "#3F7BFF"     # VLXR Streamer accent blue

font = TTFont(FONT)
UPM = font["head"].unitsPerEm
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
hmtx = font["hmtx"]

# ---- icon ----
icon = Image.open(ICON).convert("RGBA")
a = icon.getchannel("A")
icon_c = icon.crop(a.getbbox())
icon_e = icon_c.copy()
icon_e.thumbnail((256, 256), Image.LANCZOS)
buf = io.BytesIO()
icon_e.save(buf, "PNG")
ICON_B64 = base64.b64encode(buf.getvalue()).decode()
ICON_W, ICON_H = icon_e.size

DISP_H = 56.0
DISP_W = DISP_H * ICON_W / ICON_H
ICON_X = 12.0
ICON_Y = (76 - DISP_H) / 2

# ---- wordmark: "VLXR" ----
PARTS_TEXT = [("VLXR", INK)]
TRACK = 3.0
bp = BoundsPen(glyphs)
glyphs[cmap[ord("V")]].draw(bp)
cap_h = bp.bounds[3] - bp.bounds[1]
SCALE = 48.0 / cap_h
CAP_PX = cap_h * SCALE
BASELINE_Y = (76 + CAP_PX) / 2

def glyph_run(text, x, fill):
    out = []
    px = x
    for c in text:
        gname = cmap[ord(c)]
        pen = SVGPathPen(glyphs)
        glyphs[gname].draw(pen)
        d = pen.getCommands()
        if d:
            out.append(
                f'<path d="{d}" transform="translate({px:.2f} {BASELINE_Y:.2f}) '
                f'scale({SCALE:.6f} {-SCALE:.6f})" fill="{fill}"/>'
            )
        px += hmtx[gname][0] * SCALE + TRACK
    return out, px - TRACK

# measure total text width first (light pass)
measure = 0.0
for txt, _ in PARTS_TEXT:
    for c in txt:
        measure += hmtx[cmap[ord(c)]][0] * SCALE + TRACK
measure -= TRACK

text_x = ICON_X + DISP_W + 16
# centre the whole lockup in 450
lockup_w = DISP_W + 16 + measure
shift = max(0.0, (450 - lockup_w) / 2 - ICON_X)
ICON_X += shift
text_x += shift

paths = []
px = text_x
for txt, fill in PARTS_TEXT:
    seg, px = glyph_run(txt, px, fill)
    paths.extend(seg)
text_svg = "\n  ".join(paths)
print(f"icon {ICON_W}x{ICON_H} disp {DISP_W:.0f}x{DISP_H} text ends {px:.0f} shift {shift:.0f}")


def logo_svg():
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 76" width="450" height="76">\n'
        f'  <image href="data:image/png;base64,{ICON_B64}" x="{ICON_X:.1f}" y="{ICON_Y:.1f}" '
        f'width="{DISP_W:.1f}" height="{DISP_H:.1f}"/>\n'
        f'  {text_svg}\n'
        "</svg>\n"
    )


def emit(prefix):
    svg_text = logo_svg()
    with open(f"{OUT}/{prefix}.svg", "w", encoding="utf-8") as f:
        f.write(svg_text)
    for w, h, suf in [(450, 76, "450x76"), (225, 38, "225x38"), (113, 19, "113x19")]:
        png = resvg_py.svg_to_bytes(svg_text, width=w, height=h)
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        if im.size != (w, h):
            im = im.crop((0, 0, w, h))
        im.save(f"{OUT}/{prefix}-{suf}.png")
        print(prefix, suf, im.size)


emit("vlxr-logo")
# dark variant: swap ink colour for light-background use (XR stays accent blue)
svg_dark = logo_svg().replace(f'fill="{INK}"', f'fill="{INK_DARK}"')
with open(f"{OUT}/vlxr-logo-dark.svg", "w", encoding="utf-8") as f:
    f.write(svg_dark)
for w, h, suf in [(450, 76, "450x76"), (225, 38, "225x38"), (113, 19, "113x19")]:
    png = resvg_py.svg_to_bytes(svg_dark, width=w, height=h)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    if im.size != (w, h):
        im = im.crop((0, 0, w, h))
    im.save(f"{OUT}/vlxr-logo-dark-{suf}.png")
    print("dark", suf, im.size)

# favicon: icon on dark tile, aspect preserved
def png_b64(im):
    b = io.BytesIO(); im.save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()

fiw = icon_c.size[0] / icon_c.size[1]
fh = 58.0; fw = fh * fiw
if fw > 60: fw = 60.0; fh = fw / fiw
fx = (76 - fw) / 2; fy = (76 - fh) / 2
fav_svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 76" width="76" height="76">\n'
    '  <rect width="76" height="76" rx="14" fill="#0E0F13"/>\n'
    f'  <image href="data:image/png;base64,{png_b64(icon_c)}" x="{fx:.1f}" y="{fy:.1f}" width="{fw:.1f}" height="{fh:.1f}"/>\n'
    "</svg>\n"
)
with open(f"{OUT}/favicon.svg", "w", encoding="utf-8") as f:
    f.write(fav_svg)
for s in [16, 32, 64, 180]:
    png = resvg_py.svg_to_bytes(fav_svg, width=s, height=s)
    with open(f"{OUT}/favicon-{s}.png", "wb") as f:
        f.write(png)
print("favicon done")
