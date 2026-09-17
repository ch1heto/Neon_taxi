import type { CarSkin } from '../../types/game';

type Point = readonly [number, number];

const BODY: readonly Point[] = [
  [-49, -11], [-48, -15], [-44, -18], [-38, -20], [-35, -22.5], [-30.5, -24.5],
  [-26, -23.8], [-22, -21.4], [17, -21], [22, -22.3], [26, -24], [31, -24.5],
  [36, -23.6], [42, -21], [47, -17], [49.5, -11], [50, 0], [49.5, 11], [47, 17],
  [42, 21], [36, 23.6], [31, 24.5], [26, 24], [22, 22.3], [17, 21], [-22, 21.4],
  [-26, 23.8], [-30.5, 24.5], [-35, 22.5], [-38, 20], [-44, 18], [-48, 15], [-49, 11],
];

export const MAZDA_RX7_FD_VISUAL_SPEC = Object.freeze({
  front: '+X' as const,
  pivot: Object.freeze({ x: 0, y: 0 }),
  normalizedBounds: Object.freeze({ xMin: -50, xMax: 50, yMin: -25, yMax: 25 }),
  rearAxleX: -30.5,
  frontAxleX: 30.5,
  rearWingX: -48,
});

/** Fresh Canvas interpretation of the RX-7 reference blueprint. Front is +X. */
export function renderMazdaRX7FD(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
  const sx = L / 102;
  const sy = W / 51;
  const x = (value: number) => value * sx;
  const y = (value: number) => value * sy;
  const stroke = Math.max(0.65, Math.min(sx, sy) * 1.45);
  const polygon = (points: readonly Point[]) => {
    ctx.beginPath();
    points.forEach(([px, py], index) => index === 0 ? ctx.moveTo(x(px), y(py)) : ctx.lineTo(x(px), y(py)));
    ctx.closePath();
  };
  const roundedRect = (left: number, top: number, width: number, height: number, radius: number) => {
    ctx.beginPath();
    ctx.roundRect(x(left), y(top), x(width), y(height), Math.min(x(radius), y(radius)));
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Exposed wheels and a full-width GT wing define the low stance at game scale.
  ctx.fillStyle = '#07090d';
  ctx.strokeStyle = '#343842';
  ctx.lineWidth = stroke;
  for (const axle of [-30.5, 30.5]) {
    for (const wheelY of [-25, 19.5]) {
      roundedRect(axle - 7, wheelY, 14, 5.5, 2.4);
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.fillStyle = skin.secondaryColor;
  ctx.strokeStyle = '#16070b';
  ctx.lineWidth = stroke * 1.2;
  polygon([[-50, -24.8], [-45.7, -24.8], [-44.8, -20.5], [-44.8, 20.5], [-45.7, 24.8], [-50, 24.8]]);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b2d36';
  roundedRect(-51.5, -25.5, 6.8, 3.1, 0.5); ctx.fill();
  roundedRect(-51.5, 22.4, 6.8, 3.1, 0.5); ctx.fill();

  // Smooth, rounded coupe silhouette and controlled metallic red shading.
  const bodyMetal = ctx.createLinearGradient(0, y(-25), 0, y(25));
  bodyMetal.addColorStop(0, '#790a19');
  bodyMetal.addColorStop(0.23, '#ff4a55');
  bodyMetal.addColorStop(0.52, skin.primaryColor);
  bodyMetal.addColorStop(0.82, '#a70e22');
  bodyMetal.addColorStop(1, '#650714');
  polygon(BODY);
  ctx.fillStyle = bodyMetal; ctx.fill();
  ctx.strokeStyle = '#16070b'; ctx.lineWidth = stroke * 1.25; ctx.stroke();

  // Rear deck and long smooth hood are separate large planes, not legacy body shapes.
  polygon([[-47, -14], [-40, -19], [-33, -18], [-29, -13], [-29, 13], [-33, 18], [-40, 19], [-47, 14]]);
  ctx.fillStyle = '#b71129'; ctx.fill(); ctx.strokeStyle = '#64101e'; ctx.lineWidth = stroke; ctx.stroke();
  polygon([[18, -16], [35, -20], [45, -15], [49, -11], [49, 11], [45, 15], [35, 20], [18, 16], [15, 10], [15, -10]]);
  ctx.fillStyle = '#d71a32'; ctx.fill(); ctx.stroke();

  // Compact cabin mass with separately legible rear glass, roof and windshield.
  polygon([[-33, 0], [-32, -12], [-27, -18], [4, -17], [14, -16], [19, -9], [19, 9], [14, 16], [4, 17], [-27, 18], [-32, 12]]);
  ctx.fillStyle = '#0a0e13'; ctx.fill(); ctx.strokeStyle = '#16070b'; ctx.lineWidth = stroke * 1.15; ctx.stroke();
  const glass = ctx.createLinearGradient(x(-31), 0, x(18), 0);
  glass.addColorStop(0, '#09131b'); glass.addColorStop(0.55, '#142532'); glass.addColorStop(1, '#315063');
  polygon([[-31, -12], [-28, -15], [-21, -15], [-17, -11], [-17, 11], [-21, 15], [-28, 15], [-31, 12]]);
  ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = '#4a6472'; ctx.lineWidth = stroke; ctx.stroke();
  polygon([[3, -14], [9, -15], [15, -14], [18, -8], [18, 8], [15, 14], [9, 15], [3, 14], [0, 10], [0, -10]]);
  ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = '#78929f'; ctx.stroke();
  polygon([[-19, -11], [2, -10.5], [4, -7], [4, 7], [2, 10.5], [-19, 11], [-22, 8], [-22, -8]]);
  ctx.fillStyle = '#c8162e'; ctx.fill(); ctx.strokeStyle = '#64101e'; ctx.stroke();

  // Two broad hood vents replace mesh and other details that disappear below 64 px.
  ctx.fillStyle = skin.secondaryColor;
  polygon([[23, -13.8], [42, -11.5], [39, -6.2], [22, -7.5]]); ctx.fill();
  polygon([[23, 13.8], [42, 11.5], [39, 6.2], [22, 7.5]]); ctx.fill();
  for (const accent of [
    [[-39, -19.5], [-22, -19.7], [-17, -17.4], [-34, -16.7]],
    [[-39, 19.5], [-22, 19.7], [-17, 17.4], [-34, 16.7]],
    [[-2, -20.4], [13, -19.7], [17, -17.8], [2, -18.1]],
    [[-2, 20.4], [13, 19.7], [17, 17.8], [2, 18.1]],
  ] as const) { polygon(accent); ctx.fill(); }

  ctx.strokeStyle = '#560a17'; ctx.lineWidth = stroke * 1.5;
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x(-38), y(20 * side)); ctx.quadraticCurveTo(x(-30.5), y(25 * side), x(-23), y(20 * side)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x(23), y(20 * side)); ctx.quadraticCurveTo(x(30.5), y(25 * side), x(39), y(20 * side)); ctx.stroke();
  }

  // Thick, asymmetric light signatures make +X immediately readable.
  ctx.shadowColor = '#77e8ff'; ctx.shadowBlur = Math.max(2, L * 0.05);
  ctx.fillStyle = '#e9fdff'; ctx.strokeStyle = '#77e8ff'; ctx.lineWidth = stroke;
  polygon([[42, -17], [48, -13], [49, -8], [46, -8.8], [40, -13.3]]); ctx.fill(); ctx.stroke();
  polygon([[42, 17], [48, 13], [49, 8], [46, 8.8], [40, 13.3]]); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff2447'; ctx.strokeStyle = '#5b0615';
  for (const tailY of [-12, 12]) { ctx.beginPath(); ctx.ellipse(x(-46.5), y(tailY), x(2.1), y(3.1), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }

  ctx.strokeStyle = 'rgba(255, 190, 196, 0.76)'; ctx.lineWidth = stroke * 0.7;
  ctx.beginPath(); ctx.moveTo(x(22), y(-13)); ctx.quadraticCurveTo(x(36), y(-16), x(45), y(-11)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x(22), y(13)); ctx.quadraticCurveTo(x(36), y(16), x(45), y(11)); ctx.stroke();
  ctx.restore();
}
