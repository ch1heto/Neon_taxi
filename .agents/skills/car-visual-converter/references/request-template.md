# Invocation template

```text
Use $car-visual-converter.

Reference image: <absolute path or attached PNG/JPG>
Target CarSkin id: <existing id>
Model name: <display name>
Style: <visual direction>
Target dimensions: read length/width from CarSkin and keep them unchanged
Primary color: <hex or existing value>
Secondary color: <hex or existing value>
Glow color: <CSS color or existing value>

Create a fresh layered SVG blueprint, render 256 px / 96 px / 60 px previews,
simplify until the 60 px version is readable, convert it to a production Canvas 2D
renderer, integrate it through the shared city/Garage/Test Drive path, and prove
that physics and collision did not change.
```

## Example

```text
Use $car-visual-converter to convert the attached skyline-style top-down reference
into a new Neon Taxi game renderer for the `sport` skin. Keep the existing CarSkin
length and width. Use a retro-futurist street-racer style with cyan primary,
graphite secondary, and electric-blue glow. Remove all real-brand badges and model
lettering. Deliver the SVG blueprint, 256/96/60 px previews, the shared Canvas 2D
integration, and physics-guard plus test results.
```

