# Neon Street GT — Stage 1 report

## Reference roles

- Shape / silhouette reference: `ChatGPT Image 17 сент. 2026 г., 21_39_32 (2).png` (Image #1). Its plain silver panels expose the outer contour, glass boundaries, wheel arches, and spoiler more clearly.
- Livery / color reference: `ChatGPT Image 17 сент. 2026 г., 21_39_32 (1).png` (Image #2). It supplies the silver/cobalt palette, twin hood stripes, blue lower-body graphic, and blue rear wing.

Both uploaded images were loaded directly by `render_blueprint.py`. No existing Neon Taxi car renderer was used as geometry input.

## Reference analysis

- Silhouette: long, low three-box JDM coupe/sedan with a squared rear, pronounced four-corner stance, tapered nose, and full-width rear wing.
- Visible reference ratio: approximately `2.139:1` after alpha-threshold cropping.
- Wheelbase: long and visually centered; the blueprint places axles at `x=-29.5` and `x=+30.5`, or `58.8%` of the normalized full length.
- Hood: long front deck, approximately the forward `30%`, with two large vents and a mildly tapered nose.
- Windshield: broad and steeply swept, forming the front end of a continuous dark cabin mass.
- Roof: long, nearly rectangular center panel; deliberately kept substantial rather than reduced to an oval cockpit.
- Rear glass: large trapezoid tied to a short rear deck.
- Trunk / rear deck: short, broad, and visually anchored by circular red lamps and the wing.
- Spoiler: full-width cross-car wing at `x=-47.5`, with visible end plates and two supports.
- Wheel arches: four strong shoulders with wheels exposed outside the central body width.
- Headlights: narrow cyan wedges wrapping the nose corners.
- Taillights: paired red oval signatures at the rear corners.
- Color: cold metallic silver, cobalt twin stripes, cobalt rocker zones, restrained cyan glow, dark blue glass.

No logos, badges, or model lettering from a real manufacturer were retained.

## Normalized geometry

Front points toward `+X`. The design envelope is `x=-51…+51`, `y=-25…+25`.

| Anchor | Coordinate/range | Purpose |
|---|---:|---|
| Rear tip | `(-50, 0)` | squared rear bumper center |
| Front tip | `(+51, 0)` | tapered nose center |
| Rear axle | `x=-29.5` | rear stance and arch center |
| Front axle | `x=+30.5` | front stance and arch center |
| Trunk | `x=-50…-33` | short rear deck |
| Rear glass | `x=-33…-21` | rear cabin taper |
| Roof | `x=-21…+4` | long rectangular roof mass |
| Windshield | `x=+4…+20` | broad front glass |
| Hood | `x=+20…+50` | long front deck |
| Spoiler | `x=-47.5` | full-width rear signature |

The resulting visible ratio is `2.040:1`. It is intentionally about 4.6% wider than the clean reference ratio so wheels, arches, cabin taper, and light signatures survive at game scale without turning the car into a thin strip.

## Layer structure

The editable SVG separates: `body`, `hood`, `cabin`, `roof`, `trunk`, `windows` with `windshield` and `rear-glass`, `wheels`, `wheel-arches`, `headlights`, `taillights`, `spoiler`, `vents`, and `body-accents` for the livery.

## 64 px readability

The 64 px game-readable variant passes the Stage 1 readability gate:

- the long three-box silhouette and squared wing remain distinct;
- cyan front lights and red rear lights make direction immediate;
- the dark cabin reads as one large mass rather than fragmented glass;
- wheel stance and arch shoulders remain visible;
- both cobalt hood stripes survive;
- micro panel seams, side-window separators, vent outlines, and zigzag rocker details are omitted from the simple variant.

The detailed 64 px preview is included for comparison, but the simple 64 px variant is the recommended production target for the next stage.

## Reproduce previews

Run from the repository root with the bundled Python/Pillow runtime or another Python environment containing Pillow:

```powershell
python artifacts/car-visuals/neon-street-gt-stage1/render_blueprint.py `
  --shape-reference "V:\Musor_trash_TZshki\Neon_taxi\ChatGPT Image 17 сент. 2026 г., 21_39_32 (2).png" `
  --livery-reference "V:\Musor_trash_TZshki\Neon_taxi\ChatGPT Image 17 сент. 2026 г., 21_39_32 (1).png" `
  --output artifacts/car-visuals/neon-street-gt-stage1
```

## Stage boundary

This stage creates design artifacts only. No Canvas production renderer, `CarSkin`, physics, collision, gameplay, Fuel, Orders, NPC, GPS, Test Drive, or save code was changed.

