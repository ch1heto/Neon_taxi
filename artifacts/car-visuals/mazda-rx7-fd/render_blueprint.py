#!/usr/bin/env python3
"""Generate Mazda RX-7 FD visual-design previews; never touches game physics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "geometry.json").read_text(encoding="utf-8"))
C = DATA["colors"]
TOP = [tuple(point) for point in DATA["silhouetteTopEdge"]]
BODY = TOP + [(x, -y) for x, y in reversed(TOP[:-1])]
X0, X1, Y0, Y1 = -52, 50, -25.5, 25.5


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shape-reference", type=Path, required=True)
    parser.add_argument("--detail-reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=HERE)
    return parser.parse_args()


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(Path("C:/Windows/Fonts") / ("seguisb.ttf" if bold else "segoeui.ttf")), size)
    except OSError:
        return ImageFont.load_default()


def transform(axis: int, sample: int = 4):
    scale = axis * sample / (X1 - X0)
    pad = max(8 * sample, round(axis * sample * .07))
    size = (axis * sample + pad * 2, round((Y1 - Y0) * scale) + pad * 2)
    return size, scale, lambda p: (round(pad + (p[0] - X0) * scale), round(pad + (p[1] - Y0) * scale))


def gradient(image: Image.Image, mask: Image.Image) -> None:
    stops = [(121, 10, 25), (255, 74, 85), (201, 21, 45), (101, 7, 20)]
    layer = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(layer)
    for y in range(image.height):
        t = y / max(1, image.height - 1)
        segment = min(2, int(t * 3))
        local = t * 3 - segment
        a, b = stops[segment], stops[segment + 1]
        color = tuple(round(a[i] + (b[i] - a[i]) * local) for i in range(3))
        draw.line((0, y, image.width, y), fill=(*color, 255))
    image.alpha_composite(Image.composite(layer, Image.new("RGBA", image.size), mask))


def render(axis: int, variant: str) -> Image.Image:
    sample = 4
    size, scale, p = transform(axis, sample)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    pts = lambda values: [p(tuple(value)) for value in values]
    sw = lambda units: max(1, round(units * scale))

    if variant != "silhouette":
        glow = Image.new("RGBA", size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse((*p((-47, -21)), *p((48, 21))), fill=(255, 49, 95, 76))
        image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(sw(2.2))))

    for axle in (-30.5, 30.5):
        for wheel_y in (-22.25, 22.25):
            box = (*p((axle - 7, wheel_y - 2.75)), *p((axle + 7, wheel_y + 2.75)))
            draw.rounded_rectangle(box, radius=sw(2.4), fill=C["tire"], outline="#343842", width=sw(.7))

    wing = [(-50, -24.8), (-45.7, -24.8), (-44.8, -20.5), (-44.8, 20.5), (-45.7, 24.8), (-50, 24.8)]
    draw.polygon(pts(wing), fill=C["secondary"], outline="#16070B")
    draw.polygon(pts([(-51.5, -25.5), (-44.7, -25.5), (-44.7, -22.4), (-51.5, -22.4)]), fill="#2B2D36")
    draw.polygon(pts([(-51.5, 22.4), (-44.7, 22.4), (-44.7, 25.5), (-51.5, 25.5)]), fill="#2B2D36")

    if variant == "silhouette":
        draw.polygon(pts(BODY), fill="#B5132B", outline="#16070B")
        return image.resize((size[0] // sample, size[1] // sample), Image.Resampling.LANCZOS)

    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(pts(BODY), fill=255)
    if variant == "detail": gradient(image, mask)
    else: draw.polygon(pts(BODY), fill=C["primary"])
    draw = ImageDraw.Draw(image)
    draw.line(pts(BODY + [BODY[0]]), fill="#16070B", width=sw(1.2), joint="curve")

    trunk = [(-47, -14), (-40, -19), (-33, -18), (-29, -13), (-29, 13), (-33, 18), (-40, 19), (-47, 14)]
    hood = [(18, -16), (35, -20), (45, -15), (49, -11), (49, 11), (45, 15), (35, 20), (18, 16), (15, 10), (15, -10)]
    draw.polygon(pts(trunk), fill="#B71129", outline="#64101E")
    draw.polygon(pts(hood), fill="#D71A32", outline="#64101E")

    cabin = [(-33, 0), (-32, -12), (-27, -18), (4, -17), (14, -16), (19, -9), (19, 9), (14, 16), (4, 17), (-27, 18), (-32, 12)]
    rear_glass = [(-31, -12), (-28, -15), (-21, -15), (-17, -11), (-17, 11), (-21, 15), (-28, 15), (-31, 12)]
    windshield = [(3, -14), (9, -15), (15, -14), (18, -8), (18, 8), (15, 14), (9, 15), (3, 14), (0, 10), (0, -10)]
    roof = [(-19, -11), (2, -10.5), (4, -7), (4, 7), (2, 10.5), (-19, 11), (-22, 8), (-22, -8)]
    draw.polygon(pts(cabin), fill="#0A0E13", outline="#16070B")
    draw.polygon(pts(rear_glass), fill="#142532", outline="#4A6472")
    draw.polygon(pts(windshield), fill="#203B4C", outline="#78929F")
    draw.polygon(pts(roof), fill="#C8162E", outline="#64101E")

    # Broad, mirrored hood vents are kept instead of photographic mesh.
    draw.polygon(pts([(23, -13.8), (42, -11.5), (39, -6.2), (22, -7.5)]), fill=C["secondary"])
    draw.polygon(pts([(23, 13.8), (42, 11.5), (39, 6.2), (22, 7.5)]), fill=C["secondary"])
    if variant == "detail":
        for accent in [
            [(-39, -19.5), (-22, -19.7), (-17, -17.4), (-34, -16.7)],
            [(-39, 19.5), (-22, 19.7), (-17, 17.4), (-34, 16.7)],
            [(-2, -20.4), (13, -19.7), (17, -17.8), (2, -18.1)],
            [(-2, 20.4), (13, 19.7), (17, 17.8), (2, 18.1)],
        ]:
            draw.polygon(pts(accent), fill=C["secondary"])
        for arch in [
            [(-38, -20), (-35, -23), (-30.5, -24.5), (-26, -23), (-23, -20)],
            [(-38, 20), (-35, 23), (-30.5, 24.5), (-26, 23), (-23, 20)],
            [(23, -20), (26, -23), (30.5, -24.5), (35, -23), (39, -20)],
            [(23, 20), (26, 23), (30.5, 24.5), (35, 23), (39, 20)],
        ]:
            draw.line(pts(arch), fill="#560A17", width=sw(1.1), joint="curve")
        draw.line(pts([(22, -13), (36, -16), (45, -11)]), fill="#FF9AA3", width=sw(.55))
        draw.line(pts([(22, 13), (36, 16), (45, 11)]), fill="#FF9AA3", width=sw(.55))

    # Deliberately thick signatures survive the 60/64 px gate.
    for light in [
        [(42, -17), (48, -13), (49, -8), (46, -8.8), (40, -13.3)],
        [(42, 17), (48, 13), (49, 8), (46, 8.8), (40, 13.3)],
    ]:
        draw.polygon(pts(light), fill=C["headlight"], outline="#77E8FF")
    for y in (-12, 12):
        draw.ellipse((*p((-48.6, y - 3.1)), *p((-44.4, y + 3.1))), fill=C["taillight"], outline="#5B0615", width=sw(.6))
    return image.resize((size[0] // sample, size[1] // sample), Image.Resampling.LANCZOS)


def save_sets(out: Path) -> dict[str, Image.Image]:
    images = {}
    for variant, axes in {"detail": [1024, 256, 128, 96, 64, 60], "silhouette": [512, 128, 64], "game-readable": [512, 256, 128, 96, 64, 60]}.items():
        for axis in axes:
            name = f"mazda-rx7-fd-{variant}-{axis}.png"
            images[name] = render(axis, "simple" if variant == "game-readable" else variant)
            images[name].save(out / name)
    return images


def card(size=(500, 630)) -> Image.Image:
    image = Image.new("RGBA", size, "#0B111A")
    ImageDraw.Draw(image).rounded_rectangle((1, 1, size[0] - 2, size[1] - 2), radius=18, outline="#3A2630", width=2)
    return image


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    copy = image.copy(); copy.thumbnail(size, Image.Resampling.LANCZOS); return copy


def preview_board(out: Path, images: dict[str, Image.Image]) -> None:
    board = Image.new("RGB", (1600, 900), "#070B11")
    draw = ImageDraw.Draw(board)
    draw.text((54, 36), "MAZDA RX-7 FD · EXPERIMENTAL VISUAL BLUEPRINT", font=font(38, True), fill="#FFF1F3")
    draw.text((56, 88), "front = +X  ·  pivot = (0,0)  ·  Cyber GT dimensions 56 × 30", font=font(22), fill="#BC8290")
    specs = [
        ("SILHOUETTE ONLY", "mazda-rx7-fd-silhouette-512.png", "mazda-rx7-fd-silhouette-128.png", "mazda-rx7-fd-silhouette-64.png"),
        ("DETAIL BLUEPRINT", "mazda-rx7-fd-detail-1024.png", "mazda-rx7-fd-detail-128.png", "mazda-rx7-fd-detail-64.png"),
        ("GAME-READABLE", "mazda-rx7-fd-game-readable-512.png", "mazda-rx7-fd-game-readable-128.png", "mazda-rx7-fd-game-readable-64.png"),
    ]
    for i, (title, large, mid, small) in enumerate(specs):
        panel = card(); pd = ImageDraw.Draw(panel); pd.text((24, 24), title, font=font(23, True), fill="#FFD9DF")
        hero = contain(images[large], (445, 280)); panel.alpha_composite(hero, ((500 - hero.width) // 2, 90 + (260 - hero.height) // 2))
        pd.text((25, 398), "128 PX", font=font(16, True), fill="#9C6D78"); panel.alpha_composite(images[mid], (150, 380))
        pd.text((25, 525), "64 PX · ACTUAL", font=font(16, True), fill="#9C6D78"); panel.alpha_composite(images[small], (175, 505))
        board.paste(panel.convert("RGB"), (35 + i * 520, 150))
    draw.text((55, 825), "64 px anchors: compact dark cabin · smooth long hood · broad twin vents · large rear wing · white/red light split", font=font(20), fill="#C6919D")
    board.save(out / "mazda-rx7-fd-preview-board.png")


def visible_crop(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box and alpha_box != (0, 0, image.width, image.height): return image.crop(alpha_box)
    rgb = image.convert("RGB"); mask = Image.new("L", rgb.size); md = ImageDraw.Draw(mask)
    pixels = rgb.load(); out = mask.load()
    for y in range(rgb.height):
        for x in range(rgb.width): out[x, y] = 255 if max(pixels[x, y]) > 10 else 0
    return image.crop(mask.getbbox() or (0, 0, image.width, image.height))


def comparison(out: Path, shape: Path, detail: Path) -> None:
    sources = [("SHAPE · IMAGE #2", visible_crop(shape)), ("DETAILS · IMAGE #1", visible_crop(detail)), ("NEW BLUEPRINT", render(600, "detail"))]
    board = Image.new("RGB", (1740, 750), "#070B11"); draw = ImageDraw.Draw(board)
    draw.text((52, 34), "REFERENCE → STRUCTURE COMPARISON", font=font(36, True), fill="#FFF1F3")
    for i, (label, source) in enumerate(sources):
        panel = card((540, 530)); pd = ImageDraw.Draw(panel); pd.text((24, 22), label, font=font(20, True), fill="#FFD9DF")
        show = contain(source, (490, 410)); panel.alpha_composite(show, ((540 - show.width) // 2, 80 + (410 - show.height) // 2))
        board.paste(panel.convert("RGB"), (30 + i * 570, 110))
    draw.text((54, 676), "Wheelbase 61% · compact cabin x -33…+19 · long hood x +18…+49 · wing x -48 · front +X", font=font(21), fill="#C6919D")
    board.save(out / "mazda-rx7-fd-reference-comparison.png")


def main() -> None:
    options = args(); out = options.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    images = save_sets(out); preview_board(out, images); comparison(out, options.shape_reference, options.detail_reference)
    print(f"Generated Mazda RX-7 FD artifacts in {out}")


if __name__ == "__main__": main()
