---
name: car-visual-converter
description: Convert a top-down or near-top-down PNG/JPG car reference into a new silhouette-first SVG blueprint and production Canvas 2D renderer for Neon Taxi. Use when adding or replacing a car's visuals while preserving CarSkin dimensions, physics, collision, gameplay, and shared city/Garage/Test Drive rendering; do not use for vehicle tuning or collision work.
---

# Car Visual Converter

Create a reference-inspired, original car visual that reads clearly at the Neon Taxi game scale. Treat the reference as visual evidence, not as a request to reproduce brand marks or to stretch an existing in-game renderer.

## Required inputs

Collect or infer from the request and repository:

- reference PNG/JPG, preferably top-down or close to top-down;
- target model name and existing `CarSkin.id`;
- desired style;
- read-only target `CarSkin.length` and `CarSkin.width`;
- primary, secondary, and glow colors.

Ask only when the reference, target skin, or intended style cannot be identified safely. Read dimensions and existing colors from `src/game/Skins.ts` when the user points to an existing skin.

## Non-negotiable scope

- Change visual code and visual metadata only.
- Never change `length`, `width`, collision circles or radii, acceleration, braking, maximum speed, steering/turn speed, grip, dash values, durability, bonuses, or upgrade formulas.
- Never copy, stretch, or lightly reskin an old car renderer. Inspect old renderers only for coordinate conventions, the renderer interface, and the shared dispatch point.
- Remove real-brand logos, badges, wordmarks, and model lettering from the interpretation.
- Use one production renderer through the shared draw path for the city, Garage preview, and Test Drive. Do not create separate versions for those surfaces.
- Optimize first for a roughly 52–65 px vehicle length. Silhouette and proportions outrank surface detail.

## Workflow

1. Read [references/neon-taxi-integration.md](references/neon-taxi-integration.md) before editing the project.
2. Inspect the reference at original resolution. Record the front direction, silhouette, wheelbase, cabin placement, width changes, light signatures, and at most three identity-defining body features.
3. Capture a physics baseline before changing source code:

   ```powershell
   node .agents/skills/car-visual-converter/scripts/physics-guard.mjs snapshot --project-root . --output "$env:TEMP/neon-taxi-car-physics.json"
   ```

4. Follow [references/visual-workflow.md](references/visual-workflow.md) to create the layered SVG blueprint and 256 px, 96 px, and 60 px previews.
5. Review the 60 px preview. If the front/rear, windows, wheels, light signatures, or main body idea are unclear, simplify geometry and remove micro-details, then regenerate all previews.
6. Treat the blueprint as approved after it passes the objective preview checks. If the user explicitly requested a review gate, present the previews and wait before production integration.
7. Convert the approved geometry into a dedicated Canvas 2D renderer using normalized `L`/`W` coordinates and the supplied colors. Do not derive its outline from an existing renderer.
8. Register the renderer once in the shared car draw path. Confirm all three surfaces reach it through that path.
9. Complete [references/checklist.md](references/checklist.md), run the physics guard, then run lint, tests, and build:

   ```powershell
   node .agents/skills/car-visual-converter/scripts/physics-guard.mjs verify --project-root . --baseline "$env:TEMP/neon-taxi-car-physics.json"
   npm run lint
   npm test
   npm run build
   ```

10. Report the blueprint, three previews, production renderer, integration point, 60 px readability decision, regression results, and any deliberate visual-only metadata changes.

Use [references/request-template.md](references/request-template.md) when the user wants a ready-to-fill invocation prompt.

## Output contract

A completed conversion should leave:

- a layered, editable SVG blueprint;
- 256 px, 96 px, and 60 px PNG previews whose stated size is the car's longest rendered axis;
- a dedicated Canvas 2D renderer with fresh geometry;
- one shared integration route used by city, Garage, and Test Drive;
- unchanged physics/collision snapshots and passing project checks.

Do not start unrelated car conversions or rebalance any vehicle.

