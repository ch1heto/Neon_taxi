import type { CarSkin } from '../../types/game';

type Point = readonly [number, number];

const BODY: readonly Point[] = [
  [-50, -11.5], [-49, -16], [-45, -19], [-39, -21.5], [-35, -23], [-30.5, -24.5],
  [-25, -24], [-20, -22], [14, -21.7], [20, -22.4], [25, -24], [31, -24.5],
  [36, -23.6], [42, -21], [47, -17.5], [50, -12], [51, -7], [51, 7], [50, 12],
  [47, 17.5], [42, 21], [36, 23.6], [31, 24.5], [25, 24], [20, 22.4], [14, 21.7],
  [-20, 22], [-25, 24], [-30.5, 24.5], [-35, 23], [-39, 21.5], [-45, 19], [-49, 16],
  [-50, 11.5],
];

export const MERCEDES_AMG_VISUAL_SPEC = Object.freeze({
  front: '+X' as const,
  pivot: Object.freeze({ x: 0, y: 0 }),
  normalizedBounds: Object.freeze({ xMin: -52, xMax: 51, yMin: -25.2, yMax: 25.2 }),
  rearAxleX: -30.5,
  frontAxleX: 30.5,
  rearWingX: -51,
});

/** Production Canvas renderer for the approved AMG-inspired Neon Taxi reference. Front is +X. */
export function renderMercedesAMG(
  ctx: CanvasRenderingContext2D,
  L: number,
  W: number,
  skin: CarSkin,
): void {
  const sx = L / 102;
  const sy = W / 50;
  const x = (value: number) => value * sx;
  const y = (value: number) => value * sy;
  const stroke = Math.max(0.62, Math.min(sx, sy) * 1.35) * 1.2;

  const polygon = (points: readonly Point[]) => {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(x(px), y(py));
      else ctx.lineTo(x(px), y(py));
    });
    ctx.closePath();
  };

  const roundedRect = (
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
  ) => {
    ctx.beginPath();
    ctx.roundRect(
      x(left),
      y(top),
      x(width),
      y(height),
      Math.min(Math.abs(x(radius)), Math.abs(y(radius))),
    );
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Exposed wheels: intentionally broad enough to register at 64 px.
  ctx.fillStyle = '#05070a';
  ctx.strokeStyle = '#343943';
  ctx.lineWidth = stroke;
  for (const axle of [-30.5, 30.5]) {
    for (const wheelY of [-25, 19.6]) {
      roundedRect(axle - 7.3, wheelY, 14.6, 5.4, 2.3);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Full-width carbon wing from the approved preview.
  ctx.fillStyle = '#111318';
  ctx.strokeStyle = '#030507';
  ctx.lineWidth = stroke * 1.25;
  polygon([
    [-51, -24.6], [-46.7, -24.6], [-45.8, -21.3], [-45.8, 21.3],
    [-46.7, 24.6], [-51, 24.6],
  ]);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#282b31';
  roundedRect(-52, -25.2, 6.2, 3.2, 0.65);
  ctx.fill();
  roundedRect(-52, 22, 6.2, 3.2, 0.65);
  ctx.fill();

  ctx.fillStyle = skin.secondaryColor;
  roundedRect(-50.7, -25.1, 3.8, 0.8, 0.35);
  ctx.fill();
  roundedRect(-50.7, 24.3, 3.8, 0.8, 0.35);
  ctx.fill();

  // Main body: dark graphite with the same cross-body shading as the approved preview.
  const bodyMetal = ctx.createLinearGradient(0, y(-25), 0, y(25));
  bodyMetal.addColorStop(0, '#121419');
  bodyMetal.addColorStop(0.19, '#454951');
  bodyMetal.addColorStop(0.48, skin.primaryColor);
  bodyMetal.addColorStop(0.74, '#1c1f25');
  bodyMetal.addColorStop(1, '#0d0f13');
  polygon(BODY);
  ctx.fillStyle = bodyMetal;
  ctx.fill();
  ctx.strokeStyle = '#06080c';
  ctx.lineWidth = stroke * 1.32;
  ctx.stroke();

  // Rear deck with hooked shoulders / tail-light pockets.
  polygon([
    [-48, -14], [-43, -18.5], [-35, -19], [-30, -15], [-28, -11], [-28, 11],
    [-30, 15], [-35, 19], [-43, 18.5], [-48, 14],
  ]);
  ctx.fillStyle = '#25282e';
  ctx.fill();
  ctx.strokeStyle = '#101217';
  ctx.lineWidth = stroke;
  ctx.stroke();

  // Long aggressive hood with a separate central graphite blade.
  polygon([
    [18, -15], [29, -19.2], [40, -18.2], [48, -13], [50, -8], [50, 8], [48, 13],
    [40, 18.2], [29, 19.2], [18, 15], [15, 10], [15, -10],
  ]);
  const hood = ctx.createLinearGradient(x(18), 0, x(50), 0);
  hood.addColorStop(0, '#202329');
  hood.addColorStop(0.55, '#34373e');
  hood.addColorStop(1, '#16191f');
  ctx.fillStyle = hood;
  ctx.fill();
  ctx.strokeStyle = '#080a0d';
  ctx.stroke();

  // Sedan-coupe greenhouse — deliberately longer than the RX-7 cabin mass.
  polygon([
    [-34, 0], [-33, -13], [-29, -17.5], [-20, -19], [6, -18.3], [15, -16.3],
    [21, -9.5], [21, 9.5], [15, 16.3], [6, 18.3], [-20, 19], [-29, 17.5], [-33, 13],
  ]);
  ctx.fillStyle = '#070a0e';
  ctx.fill();
  ctx.strokeStyle = '#05070a';
  ctx.lineWidth = stroke * 1.15;
  ctx.stroke();

  const glass = ctx.createLinearGradient(x(-33), 0, x(20), 0);
  glass.addColorStop(0, '#09131b');
  glass.addColorStop(0.58, '#132b3d');
  glass.addColorStop(1, '#345269');

  polygon([
    [-31, -12.3], [-28, -15], [-21, -15.8], [-17, -12], [-17, 12],
    [-21, 15.8], [-28, 15], [-31, 12.3],
  ]);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = '#314354';
  ctx.lineWidth = stroke;
  ctx.stroke();

  polygon([
    [4, -14.8], [10, -15.6], [16, -13.8], [19.4, -8.4], [19.4, 8.4],
    [16, 13.8], [10, 15.6], [4, 14.8], [0.5, 10], [0.5, -10],
  ]);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = '#53697b';
  ctx.stroke();

  // Long side glazing establishes the premium four-door GT character.
  for (const side of [-1, 1]) {
    polygon([
      [-18, 11.5 * side], [-7, 12.7 * side], [3, 12.4 * side], [8, 11.1 * side],
      [7.5, 16.7 * side], [-12, 17.4 * side], [-22, 15.8 * side],
    ]);
    ctx.fillStyle = '#0d1a24';
    ctx.fill();
    ctx.strokeStyle = '#344452';
    ctx.lineWidth = stroke * 0.8;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x(-6), y(12.3 * side));
    ctx.lineTo(x(-6), y(16.6 * side));
    ctx.stroke();
  }

  // Carbon roof panel: one broad plane rather than micro-texture.
  polygon([
    [-19, -10.8], [3, -10.2], [5, -7.2], [5, 7.2], [3, 10.2],
    [-19, 10.8], [-22, 7.8], [-22, -7.8],
  ]);
  ctx.fillStyle = '#141519';
  ctx.fill();
  ctx.strokeStyle = '#4b4e53';
  ctx.lineWidth = stroke * 0.8;
  ctx.stroke();

  // Three major hood vents, widened so they survive the 64 px gate.
  ctx.fillStyle = '#090b0f';
  ctx.strokeStyle = '#555a61';
  ctx.lineWidth = stroke * 0.65;
  for (const vent of [
    [[28, -13.4], [39, -11.8], [37, -8.1], [27, -9.4]],
    [[31, -4.1], [42, -3.4], [42, 3.4], [31, 4.1], [29, 2.6], [29, -2.6]],
    [[28, 13.4], [39, 11.8], [37, 8.1], [27, 9.4]],
  ] as const) {
    polygon(vent);
    ctx.fill();
    ctx.stroke();
  }

  // Approved broad red graphic language. Secondary skin color owns the accent channel.
  ctx.fillStyle = skin.secondaryColor;
  for (const accent of [
    [[-31, -18.7], [-19, -18.5], [-10, -11.8], [-15, -11.4]],
    [[-31, 18.7], [-19, 18.5], [-10, 11.8], [-15, 11.4]],
    [[-17, -10.5], [-5, -10], [1, -7], [-10, -7.8]],
    [[-17, 10.5], [-5, 10], [1, 7], [-10, 7.8]],
    [[19, -18.2], [37, -16.6], [48, -11.8], [39, -12.2], [27, -13.6]],
    [[19, 18.2], [37, 16.6], [48, 11.8], [39, 12.2], [27, 13.6]],
    [[27, -7], [49, -4.4], [50, -1.1], [31, -4]],
    [[27, 7], [49, 4.4], [50, 1.1], [31, 4]],
    [[-43, -19], [-28, -18.4], [-21, -15.9], [-37, -16.4]],
    [[-43, 19], [-28, 18.4], [-21, 15.9], [-37, 16.4]],
  ] as const) {
    polygon(accent);
    ctx.fill();
  }

  ctx.strokeStyle = skin.secondaryColor;
  ctx.lineWidth = stroke * 1.05;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x(-39), y(20.4 * side));
    ctx.quadraticCurveTo(x(1), y(21.3 * side), x(43), y(19.2 * side));
    ctx.stroke();
  }

  // Broad wheel-arch rhythm.
  ctx.strokeStyle = '#51555d';
  ctx.lineWidth = stroke * 1.45;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x(-39), y(20 * side));
    ctx.quadraticCurveTo(x(-30.5), y(25 * side), x(-21.5), y(20.1 * side));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x(21.5), y(20.1 * side));
    ctx.quadraticCurveTo(x(30.5), y(25 * side), x(41), y(19.8 * side));
    ctx.stroke();
  }

  // Hooked red rear-light signature.
  ctx.shadowColor = skin.secondaryColor;
  ctx.shadowBlur = Math.max(1.2, L * 0.022);
  ctx.fillStyle = '#ff2037';
  ctx.strokeStyle = '#6b0711';
  ctx.lineWidth = stroke;
  polygon([[-47, -17], [-42, -19], [-36, -18], [-40, -15.2], [-46, -12.7], [-48, -13.5]]);
  ctx.fill();
  ctx.stroke();
  polygon([[-47, 17], [-42, 19], [-36, 18], [-40, 15.2], [-46, 12.7], [-48, 13.5]]);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Cold-white front bars mark +X immediately.
  ctx.shadowColor = '#b9efff';
  ctx.shadowBlur = Math.max(1.5, L * 0.032);
  ctx.fillStyle = '#e7fbff';
  ctx.strokeStyle = '#87cde8';
  ctx.lineWidth = stroke;
  polygon([[43, -17.2], [48, -13.5], [49.7, -9], [46.4, -9.6], [41.5, -13.2]]);
  ctx.fill();
  ctx.stroke();
  polygon([[43, 17.2], [48, 13.5], [49.7, 9], [46.4, 9.6], [41.5, 13.2]]);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Sparse premium-curvature highlights.
  ctx.strokeStyle = 'rgba(245, 248, 252, 0.58)';
  ctx.lineWidth = stroke * 0.65;
  ctx.beginPath();
  ctx.moveTo(x(19), y(-15));
  ctx.quadraticCurveTo(x(34), y(-18), x(46), y(-12));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x(19), y(15));
  ctx.quadraticCurveTo(x(34), y(18), x(46), y(12));
  ctx.stroke();

  ctx.restore();
}
