import type { CarSkin } from '../../types/game';

type Point = readonly [number, number];

const BODY: readonly Point[] = [
  [-49, -10.5], [-48.5, -14], [-45, -17.3], [-39, -20.1], [-34, -21.3], [-30, -22.8],
  [-24, -22.2], [-19, -20.2], [18, -20.3], [23, -21.5], [29, -22.7], [35, -22.3],
  [41, -20.2], [46, -17.3], [49, -13], [50, -8.5], [50, 8.5], [49, 13], [46, 17.3],
  [41, 20.2], [35, 22.3], [29, 22.7], [23, 21.5], [18, 20.3], [-19, 20.2], [-24, 22.2],
  [-30, 22.8], [-34, 21.3], [-39, 20.1], [-45, 17.3], [-48.5, 14], [-49, 10.5],
];

export const CITY_CRUISER_TAXI_VISUAL_SPEC = Object.freeze({
  front: '+X' as const,
  pivot: Object.freeze({ x: 0, y: 0 }),
  normalizedBounds: Object.freeze({ xMin: -50, xMax: 50, yMin: -23, yMax: 23 }),
  rearAxleX: -31,
  frontAxleX: 31,
});

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel + amount)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Production Canvas renderer for the approved City Cruiser Taxi reference. Front is +X. */
export function renderCityCruiserTaxi(
  ctx: CanvasRenderingContext2D,
  L: number,
  W: number,
  skin: CarSkin,
): void {
  const sx = L / 100;
  const sy = W / 46;
  const x = (value: number) => value * sx;
  const y = (value: number) => value * sy;
  const stroke = Math.max(0.55, Math.min(sx, sy) * 1.28) * 1.15;

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

  const arcLine = (
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
  ) => {
    ctx.beginPath();
    ctx.moveTo(x(x0), y(y0));
    ctx.quadraticCurveTo(x(cx), y(cy), x(x1), y(y1));
    ctx.stroke();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Wheels: exposed just enough to establish wheelbase at 64 px.
  ctx.fillStyle = '#080b10';
  ctx.strokeStyle = '#2b3139';
  ctx.lineWidth = stroke;
  for (const axleX of [-31, 31]) {
    for (const wheelY of [-23.4, 18.9]) {
      roundedRect(axleX - 6.8, wheelY, 13.6, 4.5, 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Main sedan silhouette and approved yellow body shading.
  const topTone = shade(skin.primaryColor, 26);
  const midTone = skin.primaryColor;
  const lowTone = shade(skin.primaryColor, -38);
  const bodyGradient = ctx.createLinearGradient(0, y(-23), 0, y(23));
  bodyGradient.addColorStop(0, lowTone);
  bodyGradient.addColorStop(0.18, topTone);
  bodyGradient.addColorStop(0.49, midTone);
  bodyGradient.addColorStop(0.78, topTone);
  bodyGradient.addColorStop(1, lowTone);
  polygon(BODY);
  ctx.fillStyle = bodyGradient;
  ctx.fill();
  ctx.strokeStyle = '#17130a';
  ctx.lineWidth = stroke * 1.18;
  ctx.stroke();

  // Rear deck — shorter and more upright than the hood.
  polygon([
    [-47, -13.5], [-42, -17.2], [-34, -18.6], [-28, -16.8], [-25, -12.5],
    [-25, 12.5], [-28, 16.8], [-34, 18.6], [-42, 17.2], [-47, 13.5],
  ]);
  ctx.fillStyle = shade(skin.primaryColor, -18);
  ctx.fill();
  ctx.strokeStyle = '#6a5200';
  ctx.lineWidth = stroke * 0.9;
  ctx.stroke();

  // Hood — long clean plane with two crease rails.
  polygon([
    [18, -15.5], [28, -19.2], [39, -18.2], [47, -14], [49, -9.3], [49, 9.3],
    [47, 14], [39, 18.2], [28, 19.2], [18, 15.5], [14, 10], [14, -10],
  ]);
  ctx.fillStyle = shade(skin.primaryColor, 4);
  ctx.fill();
  ctx.strokeStyle = '#806100';
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 245, 166, 0.72)';
  ctx.lineWidth = stroke * 0.62;
  arcLine(22, -12, 35, -15, 46, -10);
  arcLine(22, 12, 35, 15, 46, 10);

  // Cabin black surround, then separate rear glass / roof / windshield.
  polygon([
    [-31, 0], [-30, -13.7], [-25, -17.2], [8, -17.2], [16, -15], [21, -9],
    [21, 9], [16, 15], [8, 17.2], [-25, 17.2], [-30, 13.7],
  ]);
  ctx.fillStyle = '#07101a';
  ctx.fill();
  ctx.strokeStyle = '#161b20';
  ctx.lineWidth = stroke * 1.08;
  ctx.stroke();

  const glass = ctx.createLinearGradient(x(-30), 0, x(20), 0);
  glass.addColorStop(0, '#0b1620');
  glass.addColorStop(0.55, '#173149');
  glass.addColorStop(1, '#345b78');

  polygon([
    [-29, -11.4], [-26, -14.2], [-20, -14.8], [-16, -11.3],
    [-16, 11.3], [-20, 14.8], [-26, 14.2], [-29, 11.4],
  ]);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = '#39566d';
  ctx.lineWidth = stroke * 0.88;
  ctx.stroke();

  polygon([
    [4, -13.7], [10, -14.8], [16, -12.5], [19.5, -8], [19.5, 8], [16, 12.5],
    [10, 14.8], [4, 13.7], [1, 10], [1, -10],
  ]);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = '#5d788b';
  ctx.stroke();

  // Roof center, intentionally broad for sedan identity.
  polygon([
    [-18, -10.6], [2, -10.3], [5, -7], [5, 7], [2, 10.3], [-18, 10.6],
    [-21, 7.6], [-21, -7.6],
  ]);
  const roofGradient = ctx.createLinearGradient(0, y(-11), 0, y(11));
  roofGradient.addColorStop(0, shade(skin.primaryColor, -12));
  roofGradient.addColorStop(0.5, skin.primaryColor);
  roofGradient.addColorStop(1, shade(skin.primaryColor, -12));
  ctx.fillStyle = roofGradient;
  ctx.fill();
  ctx.strokeStyle = '#7c5d00';
  ctx.stroke();

  // Side window bands / B-pillars: broad enough to survive downscale.
  ctx.fillStyle = '#0c1822';
  polygon([[-22, -16.3], [6, -16.1], [10, -14.2], [-18, -13.8]]);
  ctx.fill();
  polygon([[-22, 16.3], [6, 16.1], [10, 14.2], [-18, 13.8]]);
  ctx.fill();

  ctx.fillStyle = '#3d4d5a';
  polygon([[-7, -16.3], [-4, -16.2], [-3, -14], [-6, -13.9]]);
  ctx.fill();
  polygon([[-7, 16.3], [-4, 16.2], [-3, 14], [-6, 13.9]]);
  ctx.fill();

  // Taxi sign: dominant icon at small scale, no text.
  ctx.fillStyle = shade(skin.primaryColor, 18);
  ctx.strokeStyle = '#3e3100';
  ctx.lineWidth = stroke;
  roundedRect(-7, -4.1, 12, 8.2, 2.1);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#101318';
  roundedRect(-4.4, -2.45, 1.9, 1.9, 0.25);
  ctx.fill();
  roundedRect(-2.5, -0.55, 1.9, 1.9, 0.25);
  ctx.fill();
  roundedRect(-4.4, 1.35, 1.9, 1.9, 0.25);
  ctx.fill();

  // Checker accents: simplified clusters only.
  ctx.fillStyle = skin.secondaryColor;
  const square = (cx: number, cy: number, size = 2.2) => {
    ctx.fillRect(x(cx - size / 2), y(cy - size / 2), x(size), y(size));
  };

  for (const [px, py] of [[41, -3], [43, 0], [41, 3], [45, -3], [45, 3]] as const) {
    square(px, py, 2.15);
  }
  for (const [px, py] of [[-40, -3], [-38, 0], [-40, 3], [-36, -3], [-36, 3]] as const) {
    square(px, py, 2.15);
  }
  for (const side of [-1, 1]) {
    for (const [px, py] of [
      [-12, 19.2], [-9.5, 19.2], [-7, 19.2], [6, 19.2], [8.5, 19.2], [11, 19.2],
    ] as const) {
      square(px, py * side, 1.75);
    }
  }

  // Door handles / simple side details.
  ctx.fillStyle = '#111820';
  for (const side of [-1, 1]) {
    roundedRect(-17, 17.65 * side - (side < 0 ? 1.6 : 0), 5, 1.6, 0.7);
    ctx.fill();
    roundedRect(1, 17.65 * side - (side < 0 ? 1.6 : 0), 5, 1.6, 0.7);
    ctx.fill();
  }

  // Wheel-arch rhythm, thick enough at game size.
  ctx.strokeStyle = '#8d6d00';
  ctx.lineWidth = stroke * 1.35;
  for (const side of [-1, 1]) {
    arcLine(-39, 18.5 * side, -31, 23.2 * side, -22, 19 * side);
    arcLine(22, 19 * side, 31, 23.2 * side, 41, 18.5 * side);
  }

  // Headlights: cold white/cyan, front at +X.
  ctx.shadowColor = '#9cecff';
  ctx.shadowBlur = Math.max(1.5, L * 0.035);
  ctx.fillStyle = '#e8fbff';
  ctx.strokeStyle = '#8cdcff';
  ctx.lineWidth = stroke * 0.9;
  polygon([[42, -16.7], [48, -13.1], [49, -9], [46, -9.7], [40.8, -13.7]]);
  ctx.fill();
  ctx.stroke();
  polygon([[42, 16.7], [48, 13.1], [49, 9], [46, 9.7], [40.8, 13.7]]);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Taillights: larger red wedges at the rear corners.
  ctx.fillStyle = '#ff2844';
  ctx.strokeStyle = '#670914';
  ctx.lineWidth = stroke;
  polygon([[-48, -13.7], [-43, -17], [-39, -16], [-42, -12.2], [-47, -10.7]]);
  ctx.fill();
  ctx.stroke();
  polygon([[-48, 13.7], [-43, 17], [-39, 16], [-42, 12.2], [-47, 10.7]]);
  ctx.fill();
  ctx.stroke();

  // Sparse bright highlight rails.
  ctx.strokeStyle = 'rgba(255, 255, 216, 0.82)';
  ctx.lineWidth = stroke * 0.62;
  arcLine(-42, -15, -31, -18, -22, -16);
  arcLine(24, -17, 36, -18.5, 45, -13);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  arcLine(-26, -12, -22, -14, -18, -11);
  arcLine(7, -12, 14, -13.5, 17, -9);

  ctx.restore();
}
