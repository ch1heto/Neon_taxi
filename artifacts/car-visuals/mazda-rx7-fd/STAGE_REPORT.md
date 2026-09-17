# Mazda RX-7 FD — reference to blueprint report

## Reference roles

- Shape / silhouette: `ChatGPT Image 17 сент. 2026 г., 22_43_54 (2).png`. It has the cleaner outline and less highlight noise.
- Secondary body detail: `ChatGPT Image 17 сент. 2026 г., 22_43_54 (1).png`. Its hood vent treatment, light shapes, highlights, and aero accents informed the detail layer.
- Production art contains no badge, wordmark, or traced raster content.

## Geometry

- Normalized coordinates: `x = -50..+50`, `y = -25..+25`; front is `+X`; pivot is `(0, 0)`.
- Rear/front axles: `x = -30.5 / +30.5`; wheelbase is 61% of normalized body length.
- Compact cabin: `x = -33..+19`; long hood: `x = +18..+49`; rear wing axis: `x = -48`.
- The silhouette was built from scratch as a low, smooth sports coupe. It does not derive from Skyline or any legacy capsule.

## 64 px gate

Passed after merging the photographed vent mesh into two broad dark panels and omitting badges, seams, tiny grilles, and fasteners. At 64 px the compact dark cabin, long hood, exposed wheel stance, broad rear wing, white headlights, red tail lamps, and deep-red body remain distinct.

## Physics boundary

The blueprint uses the copied Cyber GT visual dimensions (`56 × 30`) and does not change the Cyber GT entry. Physics and collision are guarded separately by `physics-baseline-mazda-before.json`.
