# Neon Taxi invariants

- Car visual changes must never alter physics or collision. Preserve `CarSkin` dimensions and performance fields, collision geometry/radii, vehicle dynamics, dash behavior, and upgrade formulas.
- A car's city, Garage preview, and Test Drive views must use the same shared visual renderer.

