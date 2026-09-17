# Car visual conversion checklist

## Before editing

- [ ] Reference image inspected at original resolution.
- [ ] Target `CarSkin.id`, model name, style, colors, `length`, and `width` recorded.
- [ ] Physics baseline captured with `physics-guard.mjs snapshot`.
- [ ] Current city, Garage, and Test Drive render paths verified.
- [ ] Old renderer geometry excluded as a design source.

## Blueprint and previews

- [ ] Fresh silhouette and major proportions designed from the reference.
- [ ] SVG layers are separated and named semantically.
- [ ] Real-brand logos, badges, and lettering removed.
- [ ] 256 px PNG generated.
- [ ] 96 px PNG generated.
- [ ] 60 px PNG generated.
- [ ] 60 px silhouette, windows, wheels, lights, and two or three signature features are readable.
- [ ] Micro-details that disappear at 60 px were removed or merged.

## Production integration

- [ ] Dedicated Canvas 2D renderer uses normalized `L`/`W` geometry.
- [ ] Renderer is deterministic and changes visual state only.
- [ ] One shared renderer is used by city, Garage, and Test Drive.
- [ ] Existing renderers were not stretched or reused as the new body.

## Regression

- [ ] Physics guard verification passes.
- [ ] Final diff contains no physics, collision, tuning, dash, or upgrade changes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Final report links the blueprint, all previews, renderer, integration point, and regression evidence.

