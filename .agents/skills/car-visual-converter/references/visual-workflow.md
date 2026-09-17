# Reference-to-renderer visual workflow

## 1. Analyze the reference

Inspect the highest-resolution source available. Determine:

- which end is the front;
- length-to-width ratio and the widest/narrowest stations;
- front and rear overhangs relative to the axles;
- cabin length, width, taper, and longitudinal position;
- hood and trunk/rear-deck proportions;
- exposed wheel placement and wheel-arch rhythm;
- headlight and taillight signatures;
- spoiler, major vents, and two or three large body accents.

Correct obvious perspective distortion mentally when the image is only near top-down. Do not preserve lens distortion, tiny seams, badges, text, grille mesh, or photographic noise.

Write a short visual brief before drawing: one silhouette sentence, one proportion sentence, and the three features that must survive at 60 px.

## 2. Build a fresh SVG blueprint

Create an editable SVG with the front pointing toward positive X. Use a normalized view box and scale only at export. Keep recognizable groups with these ids when present:

```text
body
hood
cabin
trunk
windows
wheels
wheel-arches
headlights
taillights
spoiler
vents
body-accents
```

The SVG is a geometric blueprint, not a traced painting. Use a small number of polygons, paths, rounded rectangles, and ellipses. Favor clean bilateral symmetry unless asymmetry is a deliberate major feature. Preserve the target `CarSkin` aspect ratio; do not edit `length` or `width` to make the art fit.

Use semantic colors or CSS variables for primary, secondary, glow, glass, headlights, taillights, tires, and dark accents. Remove any real-brand emblem, badge, lettering, or logo seen in the reference.

## 3. Produce previews

Export PNG previews with the car's longest visible axis rendered at:

- 256 px for shape and layer inspection;
- 96 px for mid-size UI review;
- 60 px for game-size readability.

Keep orientation, colors, transparent padding, and layer visibility consistent across all three. Also review the 60 px render over representative dark asphalt and near the intended glow color; transparent-only review can hide weak contrast.

## 4. Pass the 60 px gate

The 60 px preview passes only when all of these are true:

- the outer silhouette is recognizable without zooming;
- front and rear are immediately distinguishable;
- cabin/windows read as one clear mass rather than fragments;
- wheel placement or wheel-arch rhythm is visible;
- headlight and taillight signatures remain distinct;
- two or three major body features survive;
- no essential feature depends on a subpixel line or extremely low contrast.

When it fails, simplify in this order:

1. delete seams, texture, mesh, badges, and narrow vents;
2. merge adjacent window and accent shapes;
3. thicken light signatures and important gaps;
4. exaggerate only the major silhouette break, cabin taper, spoiler, or wheel stance needed for recognition;
5. reduce glow that washes out edges.

Regenerate all three previews after geometry changes. Do not compensate for an unreadable silhouette by adding more detail.

## 5. Convert to Canvas 2D

Translate the approved blueprint into a dedicated renderer; do not embed the SVG or use a raster sprite as the production shortcut unless the user explicitly changes the requirement.

- Express X coordinates as fractions of `L` and Y coordinates as fractions of `W`.
- Draw from back to front: under-body accents if model-specific, wheels, main body, hood/trunk, cabin/windows, large accents/vents, spoiler, then light signatures.
- Keep the blueprint's semantic layers recognizable in function names or short comments.
- Use primary, secondary, and glow colors from `CarSkin`; derive only a small neutral palette for glass, tires, highlights, headlights, and taillights.
- Avoid repeated shadows, filters, gradients, and micro-paths that add cost without surviving at game size.
- Keep drawing pure: no random values, physics reads/writes, timers, input, collision data, or gameplay state.

Render the Canvas implementation at the same three sizes and compare it to the blueprint. The production renderer, not only the SVG, must pass the 60 px gate.

