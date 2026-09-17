#!/usr/bin/env python3
"""Generate Stage 1 Neon Street GT blueprint and preview artifacts.

This script is intentionally isolated from runtime game code. It creates design
artifacts only and does not import or modify physics, CarSkin, or renderer files.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


HERE = Path(__file__).resolve().parent
GEOMETRY = json.loads((HERE / "geometry.json").read_text(encoding="utf-8"))
COLORS = GEOMETRY["colors"]

BODY_TOP = [tuple(point) for point in GEOMETRY["silhouette_top_edge"]]
BODY = BODY_TOP + [(x, -y) for x, y in reversed(BODY_TOP[:-1])]

WHEEL_CENTERS = (-29.5, 30.5)
GEOMETRY_X_MIN = -51
GEOMETRY_X_MAX = 51
GEOMETRY_Y_MIN = -25
GEOMETRY_Y_MAX = 25


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shape-reference", type=Path, required=True)
    parser.add_argument("--livery-reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=HERE)
    return parser.parse_args()


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    font_name = "seguisb.ttf" if bold else "segoeui.ttf"
    font_path = Path("C:/Windows/Fonts") / font_name
    try:
        return ImageFont.truetype(str(font_path), size=size)
    except OSError:
        return ImageFont.load_default()


def polygon_svg(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:g},{y:g}" for x, y in points)


def write_blueprint_svg(output: Path) -> None:
    body_points = polygon_svg(BODY)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-58 -31 116 62" role="img" aria-labelledby="title desc">
  <title id="title">Neon Street GT normalized top-down blueprint</title>
  <desc id="desc">Original JDM street-racing car geometry. Front points toward positive X. No brand marks.</desc>
  <defs>
    <linearGradient id="bodyMetal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#728AA3"/>
      <stop offset="0.28" stop-color="{COLORS['primary_highlight']}"/>
      <stop offset="0.56" stop-color="{COLORS['primary']}"/>
      <stop offset="1" stop-color="#627991"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0A1725"/>
      <stop offset="0.5" stop-color="{COLORS['glass']}"/>
      <stop offset="1" stop-color="#1E4664"/>
    </linearGradient>
    <filter id="softGlow" x="-40%" y="-60%" width="180%" height="220%">
      <feGaussianBlur stdDeviation="1.2"/>
    </filter>
    <style>
      .outline {{ stroke:#071521; stroke-width:1.05; stroke-linejoin:round; vector-effect:non-scaling-stroke; }}
      .panel {{ stroke:#40566C; stroke-width:.65; stroke-linejoin:round; vector-effect:non-scaling-stroke; }}
      .fine {{ fill:none; stroke:#DDEAF5; stroke-width:.5; stroke-linecap:round; vector-effect:non-scaling-stroke; opacity:.78; }}
    </style>
  </defs>

  <g id="glow" opacity=".25" filter="url(#softGlow)">
    <ellipse cx="0" cy="0" rx="49" ry="20.8" fill="{COLORS['glow']}"/>
  </g>

  <g id="wheels">
    <g fill="{COLORS['tire']}" stroke="#324B61" stroke-width=".7">
      <rect x="-36.5" y="-25" width="14" height="5.2" rx="2.2"/>
      <rect x="-36.5" y="19.8" width="14" height="5.2" rx="2.2"/>
      <rect x="23.5" y="-25" width="14" height="5.2" rx="2.2"/>
      <rect x="23.5" y="19.8" width="14" height="5.2" rx="2.2"/>
    </g>
    <g fill="none" stroke="#91A5B8" stroke-width=".55">
      <line x1="-34" y1="-22.4" x2="-25" y2="-22.4"/><line x1="-34" y1="22.4" x2="-25" y2="22.4"/>
      <line x1="26" y1="-22.4" x2="35" y2="-22.4"/><line x1="26" y1="22.4" x2="35" y2="22.4"/>
    </g>
  </g>

  <g id="spoiler">
    <path d="M-49 -24.5 L-45.5 -24.5 L-45.5 24.5 L-49 24.5 Z" fill="{COLORS['secondary']}" class="outline"/>
    <path d="M-50.5 -25.5 L-44.5 -25.5 L-44.5 -22.7 L-50.5 -22.7 Z M-50.5 22.7 L-44.5 22.7 L-44.5 25.5 L-50.5 25.5 Z" fill="#123987"/>
    <rect x="-45.7" y="-15.5" width="4.4" height="2.2" rx=".7" fill="#172638"/>
    <rect x="-45.7" y="13.3" width="4.4" height="2.2" rx=".7" fill="#172638"/>
  </g>

  <g id="body">
    <polygon points="{body_points}" fill="url(#bodyMetal)" class="outline"/>
    <path d="M-46 -17 Q-39 -20 -35 -21 M-46 17 Q-39 20 -35 21 M41 -19 Q47 -15 49 -9 M41 19 Q47 15 49 9" class="fine"/>
  </g>

  <g id="trunk" class="panel">
    <path d="M-48 -15 Q-42 -19 -34 -18.5 L-31 -13 L-31 13 L-34 18.5 Q-42 19 -48 15 Z" fill="#8499AE"/>
    <path d="M-47 -11 L-34 -12 M-47 11 L-34 12" class="fine"/>
  </g>

  <g id="hood" class="panel">
    <path d="M19 -15.3 Q34 -18.3 44 -15.5 Q49 -12 50 -7 L50 7 Q49 12 44 15.5 Q34 18.3 19 15.3 L16 10 L16 -10 Z" fill="#C2D0DD"/>
    <path d="M23 -13 Q38 -15 46 -11 M23 13 Q38 15 46 11" class="fine"/>
  </g>

  <g id="body-accents">
    <path d="M18 -7 L49 -6.3 L50 -1.8 L18 -2.3 Z" fill="{COLORS['secondary']}"/>
    <path d="M18 2.3 L50 1.8 L49 6.3 L18 7 Z" fill="{COLORS['secondary']}"/>
    <path d="M-42 -20.1 L14 -19.6 L20 -17.4 L-34 -17.2 Z" fill="{COLORS['secondary']}" opacity=".96"/>
    <path d="M-42 20.1 L14 19.6 L20 17.4 L-34 17.2 Z" fill="{COLORS['secondary']}" opacity=".96"/>
    <path d="M-34 -19.5 L-23 -17.6 L-16 -19.2 L-7 -17.6 L2 -19.1" fill="none" stroke="#76B8FF" stroke-width="1.05"/>
    <path d="M-34 19.5 L-23 17.6 L-16 19.2 L-7 17.6 L2 19.1" fill="none" stroke="#76B8FF" stroke-width="1.05"/>
  </g>

  <g id="cabin">
    <path d="M-34 0 Q-34 -15 -29 -18 L8 -17.3 Q17 -16 21 -9 L21 9 Q17 16 8 17.3 L-29 18 Q-34 15 -34 0 Z" fill="#07131F" class="outline"/>
  </g>

  <g id="windows">
    <g id="windshield">
      <path d="M4 -14.2 L10 -15.2 Q17 -13.5 19.5 -8.5 L19.5 8.5 Q17 13.5 10 15.2 L4 14.2 L1 10.5 L1 -10.5 Z" fill="url(#glass)" class="panel"/>
      <path d="M16 -10 Q18 -5 18 0 Q18 5 16 10" class="fine"/>
    </g>
    <g id="rear-glass">
      <path d="M-32 -12 Q-29 -15 -22 -15.2 L-18 -11 L-18 11 L-22 15.2 Q-29 15 -32 12 Z" fill="url(#glass)" class="panel"/>
    </g>
    <path d="M-22 -16.1 L3 -15 L0 -11.5 L-19 -12.2 Z" fill="#15344D" class="panel"/>
    <path d="M-22 16.1 L3 15 L0 11.5 L-19 12.2 Z" fill="#15344D" class="panel"/>
  </g>

  <g id="roof">
    <path d="M-21 -11.4 L3 -10.7 L5 -7.5 L5 7.5 L3 10.7 L-21 11.4 L-23 8.2 L-23 -8.2 Z" fill="#B7C8D8" class="panel"/>
    <path d="M-18 -9.2 L1 -8.7 M-18 9.2 L1 8.7" class="fine"/>
  </g>

  <g id="vents">
    <path d="M31 -13.2 L40 -12.3 L38 -9.2 L30 -9.8 Z" fill="#0B1824" class="panel"/>
    <path d="M31 13.2 L40 12.3 L38 9.2 L30 9.8 Z" fill="#0B1824" class="panel"/>
  </g>

  <g id="wheel-arches" fill="none" stroke="#263B4E" stroke-width="1.05" stroke-linecap="round">
    <path d="M-38 -20 Q-30 -25 -21 -20 M-38 20 Q-30 25 -21 20"/>
    <path d="M22 -20 Q30 -25 40 -20 M22 20 Q30 25 40 20"/>
  </g>

  <g id="headlights">
    <path d="M43 -17 Q48 -14 49.6 -9 L46.5 -9.8 L42 -13.2 Z" fill="{COLORS['headlight']}" stroke="{COLORS['glow']}" stroke-width=".55"/>
    <path d="M43 17 Q48 14 49.6 9 L46.5 9.8 L42 13.2 Z" fill="{COLORS['headlight']}" stroke="{COLORS['glow']}" stroke-width=".55"/>
  </g>

  <g id="taillights">
    <ellipse cx="-47.2" cy="-12.5" rx="2" ry="3.2" fill="{COLORS['taillight']}" stroke="#5A0A19" stroke-width=".65"/>
    <ellipse cx="-47.2" cy="12.5" rx="2" ry="3.2" fill="{COLORS['taillight']}" stroke="#5A0A19" stroke-width=".65"/>
  </g>

  <g id="blueprint-anchors" display="none" fill="#FF4FD8">
    <circle cx="-29.5" cy="0" r="1"/><circle cx="30.5" cy="0" r="1"/>
    <circle cx="-33" cy="0" r="1"/><circle cx="20" cy="0" r="1"/>
  </g>
</svg>
'''
    (output / "neon-street-gt-blueprint.svg").write_text(svg, encoding="utf-8")


def create_transform(axis_px: int, supersample: int = 4):
    axis_hi = axis_px * supersample
    scale = axis_hi / (GEOMETRY_X_MAX - GEOMETRY_X_MIN)
    pad = max(8 * supersample, round(axis_hi * 0.075))
    width = axis_hi + pad * 2
    height = round((GEOMETRY_Y_MAX - GEOMETRY_Y_MIN) * scale) + pad * 2

    def point(value: tuple[float, float]) -> tuple[int, int]:
        x, y = value
        return (
            round(pad + (x - GEOMETRY_X_MIN) * scale),
            round(pad + (y - GEOMETRY_Y_MIN) * scale),
        )

    return width, height, scale, point


def paint_gradient(image: Image.Image, mask: Image.Image, top: str, middle: str, bottom: str) -> None:
    def rgb(hex_color: str) -> tuple[int, int, int]:
        value = hex_color.lstrip("#")
        return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))

    colors = [rgb(top), rgb(middle), rgb(bottom)]
    gradient = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(gradient)
    for y in range(image.height):
        t = y / max(1, image.height - 1)
        if t <= 0.42:
            local = t / 0.42
            first, second = colors[0], colors[1]
        else:
            local = (t - 0.42) / 0.58
            first, second = colors[1], colors[2]
        color = tuple(round(first[channel] + (second[channel] - first[channel]) * local) for channel in range(3))
        draw.line((0, y, image.width, y), fill=(*color, 255))
    image.alpha_composite(Image.composite(gradient, Image.new("RGBA", image.size), mask))


def render_car(axis_px: int, variant: str) -> Image.Image:
    supersample = 4
    width, height, scale, point = create_transform(axis_px, supersample)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def pts(values):
        return [point(tuple(value)) for value in values]

    def sw(units: float) -> int:
        return max(1, round(units * scale))

    # Bounded underglow, visible only in rendered previews.
    if variant != "silhouette":
        glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        glow_draw.ellipse((*point((-46, -21)), *point((47, 21))), fill=(0, 168, 255, 92))
        glow = glow.filter(ImageFilter.GaussianBlur(sw(2.4)))
        image.alpha_composite(glow)

    # Wheels and spoiler remain part of the silhouette at every scale.
    for center_x in WHEEL_CENTERS:
        for center_y in (-22.4, 22.4):
            left, top = point((center_x - 7, center_y - 2.6))
            right, bottom = point((center_x + 7, center_y + 2.6))
            draw.rounded_rectangle((left, top, right, bottom), radius=sw(2.1), fill=COLORS["tire"], outline="#355069", width=sw(0.65))
            if variant == "detail":
                draw.line((point((center_x - 4.4, center_y)), point((center_x + 4.4, center_y))), fill="#A9BBCB", width=sw(0.45))

    draw.polygon(pts([(-49, -24.5), (-45.5, -24.5), (-45.5, 24.5), (-49, 24.5)]), fill=COLORS["secondary"], outline="#071521")
    draw.polygon(pts([(-50.5, -25.5), (-44.5, -25.5), (-44.5, -22.7), (-50.5, -22.7)]), fill="#123987")
    draw.polygon(pts([(-50.5, 22.7), (-44.5, 22.7), (-44.5, 25.5), (-50.5, 25.5)]), fill="#123987")

    body_mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(body_mask).polygon(pts(BODY), fill=255)
    if variant == "silhouette":
        draw.polygon(pts(BODY), fill="#527391", outline="#071521")
        return image.resize((width // supersample, height // supersample), Image.Resampling.LANCZOS)

    if variant == "detail":
        paint_gradient(image, body_mask, "#637D96", COLORS["primary_highlight"], "#60758A")
    else:
        draw.polygon(pts(BODY), fill=COLORS["primary"])
    draw = ImageDraw.Draw(image)
    draw.line(pts(BODY + [BODY[0]]), fill="#071521", width=sw(1.05), joint="curve")

    # Trunk and hood establish the three-box sports-car proportions.
    trunk = [(-48, -15), (-42, -19), (-34, -18.5), (-31, -13), (-31, 13), (-34, 18.5), (-42, 19), (-48, 15)]
    hood = [(19, -15.3), (34, -18.3), (44, -15.5), (49, -12), (50, -7), (50, 7), (49, 12), (44, 15.5), (34, 18.3), (19, 15.3), (16, 10), (16, -10)]
    draw.polygon(pts(trunk), fill="#8499AE", outline="#40566C")
    draw.polygon(pts(hood), fill="#C2D0DD", outline="#40566C")

    # Livery: two strong hood bands and mirrored side-skirt color zones.
    draw.polygon(pts([(18, -7), (49, -6.3), (50, -1.8), (18, -2.3)]), fill=COLORS["secondary"])
    draw.polygon(pts([(18, 2.3), (50, 1.8), (49, 6.3), (18, 7)]), fill=COLORS["secondary"])
    draw.polygon(pts([(-42, -20.1), (14, -19.6), (20, -17.4), (-34, -17.2)]), fill=COLORS["secondary"])
    draw.polygon(pts([(-42, 20.1), (14, 19.6), (20, 17.4), (-34, 17.2)]), fill=COLORS["secondary"])

    # Cabin base, separately readable windshield/rear glass, and metallic roof.
    cabin = [(-34, 0), (-33, -12), (-29, -18), (8, -17.3), (17, -16), (21, -9), (21, 9), (17, 16), (8, 17.3), (-29, 18), (-33, 12)]
    windshield = [(4, -14.2), (10, -15.2), (17, -13.5), (19.5, -8.5), (19.5, 8.5), (17, 13.5), (10, 15.2), (4, 14.2), (1, 10.5), (1, -10.5)]
    rear_glass = [(-32, -12), (-29, -15), (-22, -15.2), (-18, -11), (-18, 11), (-22, 15.2), (-29, 15), (-32, 12)]
    roof = [(-21, -11.4), (3, -10.7), (5, -7.5), (5, 7.5), (3, 10.7), (-21, 11.4), (-23, 8.2), (-23, -8.2)]
    draw.polygon(pts(cabin), fill="#07131F", outline="#071521")
    draw.polygon(pts(windshield), fill="#173D5A", outline="#55738B")
    draw.polygon(pts(rear_glass), fill="#102B43", outline="#55738B")
    if variant == "detail":
        draw.polygon(pts([(-22, -16.1), (3, -15), (0, -11.5), (-19, -12.2)]), fill="#15344D", outline="#40566C")
        draw.polygon(pts([(-22, 16.1), (3, 15), (0, 11.5), (-19, 12.2)]), fill="#15344D", outline="#40566C")
    draw.polygon(pts(roof), fill="#B7C8D8", outline="#40566C")

    if variant == "detail":
        # Wheel arches and major vents; deliberately no seams, badges, or mesh.
        for arch in [
            [(-38, -20), (-34, -23), (-29.5, -24), (-25, -23), (-21, -20)],
            [(-38, 20), (-34, 23), (-29.5, 24), (-25, 23), (-21, 20)],
            [(22, -20), (26, -23), (30.5, -24), (35, -23), (40, -20)],
            [(22, 20), (26, 23), (30.5, 24), (35, 23), (40, 20)],
        ]:
            draw.line(pts(arch), fill="#263B4E", width=sw(1.0), joint="curve")
        draw.polygon(pts([(31, -13.2), (40, -12.3), (38, -9.2), (30, -9.8)]), fill="#0B1824", outline="#40566C")
        draw.polygon(pts([(31, 13.2), (40, 12.3), (38, 9.2), (30, 9.8)]), fill="#0B1824", outline="#40566C")
        draw.line(pts([(-34, -19.5), (-23, -17.6), (-16, -19.2), (-7, -17.6), (2, -19.1)]), fill="#76B8FF", width=sw(0.9))
        draw.line(pts([(-34, 19.5), (-23, 17.6), (-16, 19.2), (-7, 17.6), (2, 19.1)]), fill="#76B8FF", width=sw(0.9))
        draw.line((point((23, -13)), point((45, -10.5))), fill="#EDF7FF", width=sw(0.45))
        draw.line((point((23, 13)), point((45, 10.5))), fill="#EDF7FF", width=sw(0.45))

    # Strong, asymmetric front/rear signatures survive the 64 px reduction.
    draw.polygon(pts([(43, -17), (48, -14), (49.6, -9), (46.5, -9.8), (42, -13.2)]), fill=COLORS["headlight"], outline=COLORS["glow"])
    draw.polygon(pts([(43, 17), (48, 14), (49.6, 9), (46.5, 9.8), (42, 13.2)]), fill=COLORS["headlight"], outline=COLORS["glow"])
    for tail_y in (-12.5, 12.5):
        left, top = point((-49.2, tail_y - 3.2))
        right, bottom = point((-45.2, tail_y + 3.2))
        draw.ellipse((left, top, right, bottom), fill=COLORS["taillight"], outline="#5A0A19", width=sw(0.55))

    return image.resize((width // supersample, height // supersample), Image.Resampling.LANCZOS)


def save_variant_set(output: Path) -> dict[str, Image.Image]:
    generated: dict[str, Image.Image] = {}
    specs = [
        ("detail", 1024, "neon-street-gt-detail-large-1024.png"),
        ("detail", 128, "neon-street-gt-detail-128.png"),
        ("detail", 64, "neon-street-gt-detail-64.png"),
        ("silhouette", 512, "neon-street-gt-silhouette-512.png"),
        ("silhouette", 128, "neon-street-gt-silhouette-128.png"),
        ("silhouette", 64, "neon-street-gt-silhouette-64.png"),
        ("simple", 512, "neon-street-gt-game-readable-512.png"),
        ("simple", 128, "neon-street-gt-game-readable-128.png"),
        ("simple", 64, "neon-street-gt-game-readable-64.png"),
    ]
    for variant, axis, filename in specs:
        image = render_car(axis, variant)
        image.save(output / filename)
        generated[filename] = image
    return generated


def dark_card(width: int, height: int) -> Image.Image:
    card = Image.new("RGBA", (width, height), "#0B121C")
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((1, 1, width - 2, height - 2), radius=18, outline="#26384A", width=2)
    return card


def contain(image: Image.Image, width: int, height: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((width, height), Image.Resampling.LANCZOS)
    return copy


def make_preview_board(output: Path, images: dict[str, Image.Image]) -> None:
    board = Image.new("RGB", (1800, 1020), "#070C13")
    draw = ImageDraw.Draw(board)
    draw.text((70, 46), "NEON STREET GT · STAGE 1 BLUEPRINT", font=font(42, True), fill="#EAF6FF")
    draw.text((72, 100), "front = +X  ·  normalized geometry  ·  no runtime integration", font=font(24), fill="#7FA4C2")

    columns = [
        ("SILHOUETTE ONLY", "neon-street-gt-silhouette-512.png"),
        ("DETAIL BLUEPRINT", "neon-street-gt-detail-large-1024.png"),
        ("GAME-READABLE", "neon-street-gt-game-readable-512.png"),
    ]
    for index, (title, filename) in enumerate(columns):
        x = 55 + index * 580
        card = dark_card(540, 690)
        card_draw = ImageDraw.Draw(card)
        card_draw.text((28, 26), title, font=font(25, True), fill="#CFEAFF")
        car = contain(images[filename], 480, 300)
        card.alpha_composite(car, ((540 - car.width) // 2, 105 + (260 - car.height) // 2))

        for label, small_name, y in [
            ("128 PX", "neon-street-gt-detail-128.png" if index == 1 else ("neon-street-gt-silhouette-128.png" if index == 0 else "neon-street-gt-game-readable-128.png"), 430),
            ("64 PX · ACTUAL", "neon-street-gt-detail-64.png" if index == 1 else ("neon-street-gt-silhouette-64.png" if index == 0 else "neon-street-gt-game-readable-64.png"), 565),
        ]:
            if small_name not in images:
                continue
            card_draw.text((28, y), label, font=font(17, True), fill="#6889A6")
            small = images[small_name]
            card.alpha_composite(small, (165, y - 8))

        board.paste(card.convert("RGB"), (x, 180))

    draw.text((70, 925), "Readable anchors: long three-box silhouette · dark cabin mass · wide stance · rear wing · blue twin stripes · cyan/red light signatures", font=font(22), fill="#8FB7D7")
    board.save(output / "neon-street-gt-preview-board.png")


def trim_reference(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: 255 if value > 128 else 0)
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError(f"Reference has no visible pixels: {path}")
    return image.crop(bbox)


def make_reference_comparison(output: Path, shape_path: Path, livery_path: Path) -> None:
    refs = [trim_reference(shape_path), trim_reference(livery_path), render_car(620, "detail")]
    labels = ["SHAPE REFERENCE", "LIVERY / COLOR REFERENCE", "NEW VECTOR BLUEPRINT"]
    board = Image.new("RGB", (1920, 900), "#070C13")
    draw = ImageDraw.Draw(board)
    draw.text((64, 42), "REFERENCE → BLUEPRINT STRUCTURE COMPARISON", font=font(40, True), fill="#EAF6FF")

    for index, (source, label) in enumerate(zip(refs, labels)):
        x = 45 + index * 625
        card = dark_card(590, 590)
        card_draw = ImageDraw.Draw(card)
        card_draw.text((24, 24), label, font=font(21, True), fill="#BFDFFF")
        display = contain(source, 540, 430)
        card.alpha_composite(display, ((590 - display.width) // 2, 90 + (430 - display.height) // 2))
        board.paste(card.convert("RGB"), (x, 125))

    metrics = [
        "Reference visible ratio: 2.139 : 1",
        "Blueprint visible ratio: 2.040 : 1",
        "Wheelbase: 60 / 102 = 58.8%",
        "Cabin: x -33 … +20",
        "Hood: x +20 … +50",
        "Spoiler axis: x -47.5",
    ]
    for index, text in enumerate(metrics):
        column = index % 3
        row = index // 3
        draw.text((75 + column * 610, 755 + row * 48), text, font=font(21), fill="#86ABC8")
    board.save(output / "neon-street-gt-reference-comparison.png")


def make_proportion_overlay(output: Path, shape_path: Path) -> None:
    reference = trim_reference(shape_path)
    reference = contain(reference, 1500, 700)
    canvas = Image.new("RGBA", (1700, 900), "#070C13")
    canvas.alpha_composite(reference, ((1700 - reference.width) // 2, 120 + (650 - reference.height) // 2))
    draw = ImageDraw.Draw(canvas)
    draw.text((60, 38), "PROPORTION OVERLAY · SHAPE REFERENCE + BLUEPRINT ANCHORS", font=font(36, True), fill="#EAF6FF")

    ref_x = (1700 - reference.width) // 2
    ref_y = 120 + (650 - reference.height) // 2
    length_scale = reference.width / (GEOMETRY_X_MAX - GEOMETRY_X_MIN)
    center_y = ref_y + reference.height / 2

    def overlay_point(value: tuple[float, float]) -> tuple[int, int]:
        x, y = value
        return (
            round(ref_x + (x - GEOMETRY_X_MIN) * length_scale),
            round(center_y + y * length_scale),
        )

    draw.line([overlay_point(point) for point in BODY + [BODY[0]]], fill="#00E5FF", width=5, joint="curve")
    for axle_x, label in [(-29.5, "REAR AXLE"), (30.5, "FRONT AXLE")]:
        x, _ = overlay_point((axle_x, 0))
        draw.line((x, ref_y - 22, x, ref_y + reference.height + 22), fill="#FF4FD8", width=3)
        draw.text((x - 68, ref_y + reference.height + 32), label, font=font(17, True), fill="#FF8DE8")
    for boundary_x, label in [(-33, "CABIN"), (20, "HOOD")]:
        x, _ = overlay_point((boundary_x, 0))
        draw.line((x, ref_y + 30, x, ref_y + reference.height - 30), fill="#FFD24A", width=2)
        draw.text((x + 8, ref_y + 12), label, font=font(16, True), fill="#FFE28C")

    draw.text((60, 835), "cyan: new silhouette  ·  magenta: axle centers  ·  yellow: cabin/hood boundaries", font=font(22), fill="#91B4D0")
    canvas.convert("RGB").save(output / "neon-street-gt-proportion-overlay.png")


def main() -> None:
    args = parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    write_blueprint_svg(output)
    images = save_variant_set(output)
    make_preview_board(output, images)
    make_reference_comparison(output, args.shape_reference, args.livery_reference)
    make_proportion_overlay(output, args.shape_reference)
    print(f"Generated Neon Street GT Stage 1 artifacts in {output}")


if __name__ == "__main__":
    main()
