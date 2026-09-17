# Neon Taxi integration map

Read this reference before editing a car renderer in this repository.

## Current shared render path

- `src/game/Car.ts`
  - `Car.render(...)` places the live vehicle and calls `Car.drawCarDetailed(...)`.
  - `Car.drawCarDetailed(...)` is the shared visual dispatch point.
- `src/components/CarPreviewCanvas.tsx`
  - Garage preview calls `Car.drawCarDetailed(...)` directly.
- `src/components/TestDrive.tsx`
  - Test Drive calls `session.car.render(...)`, which reaches the same shared draw path.
- `src/game/Skins.ts`
  - `CAR_SKINS` contains visual colors and physical/gameplay values.
- `src/types/game.ts`
  - `CarSkin` and `CarModelType` define the skin data contract.

Register new geometry once at the shared draw point. Never duplicate the car body in Garage or Test Drive code.

## Recommended extension shape

Prefer a dedicated renderer module or renderer registry keyed by a stable visual identifier such as the skin id. Pass a compact visual context containing the canvas context, `L`, `W`, and the skin colors. Keep transforms, underglow, and shared placement outside the model renderer when they are truly common.

If the current union or dispatch table needs a new visual-only key, changing that key is allowed. Do not use this as permission to edit dimensions or performance values. Avoid routing a new car through an old renderer merely because it has a similar vehicle class.

## Protected state

Treat these as read-only during a visual conversion:

- `CarSkin.length` and `CarSkin.width`;
- `maxSpeed`, `acceleration`, `braking`, `steering`, `grip`, `durability`;
- `dashPower`, `dashCooldown`, `speedBonus`, `handlingBonus`, `armorBonus`;
- `Car.collisionRadius` and every collision circle, contact, rollback, or prediction formula;
- `Car.applyUpgrades(...)` and all upgrade price/level formulas;
- Test Drive handling/tuning and map collision code.

Primary, secondary, glow, trail, description, and a visual-only renderer identifier are visual metadata. Change them only when the conversion request calls for it.

## Renderer conventions

- The current car local axis points forward along positive X; preserve that convention.
- Derive every point from `L` and `W`. Do not hard-code a second physical size.
- Wrap renderer state changes in `ctx.save()` / `ctx.restore()` or rely on the shared caller's save/restore contract only when verified.
- Begin a new path before every independent filled or stroked shape.
- Use deterministic geometry. Visual rendering must not affect update state or collision state.
- Keep shadows and glow bounded so a 60 px car stays readable against dark asphalt.

## Regression evidence

Before editing, run `scripts/physics-guard.mjs snapshot`. After editing, run its `verify` mode. Then run:

```powershell
npm run lint
npm test
npm run build
```

Also inspect the final diff. Expected changes belong to visual renderer code, visual dispatch, visual artifacts, and explicitly requested visual metadata. Any physics or collision diff is a failed conversion, even if tests pass.

