import type { CarSkin } from '../../types/game';

type Point = readonly [number, number];

const BODY: readonly Point[] = [
  [-50, -12.5], [-49, -16.5], [-42, -20], [-36, -21.5], [-34, -23], [-29.5, -24],
  [-25, -23.5], [-20, -21.5], [15, -21.5], [23, -22], [27, -23.8], [34, -23.8],
  [41, -21.5], [47, -18], [50, -12], [51, -7], [51, 7], [50, 12], [47, 18],
  [41, 21.5], [34, 23.8], [27, 23.8], [23, 22], [15, 21.5], [-20, 21.5],
  [-25, 23.5], [-29.5, 24], [-34, 23], [-36, 21.5], [-42, 20], [-49, 16.5], [-50, 12.5],
];

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: (value: number) => number,
  y: (value: number) => number,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x(left), y(top), x(width), y(height), Math.min(x(radius), y(radius)));
}

/** Fresh Canvas interpretation of the approved normalized Stage 1 blueprint. Front is +X. */
export function renderNeonStreetGT(
  ctx: CanvasRenderingContext2D,
  L: number,
  W: number,
  skin: CarSkin,
) {
  const sx = L / 102;
  const sy = W / 50;
  const x = (value: number) => value * sx;
  const y = (value: number) => value * sy;
  const stroke = Math.max(0.65, Math.min(sx, sy) * 1.35);
  const polygon = (points: readonly Point[]) => {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(x(px), y(py));
      else ctx.lineTo(x(px), y(py));
    });
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Blueprint wheels: exposed enough to keep the stance readable at 52–65 px.
  ctx.fillStyle = '#07101a';
  ctx.strokeStyle = '#324b61';
  ctx.lineWidth = stroke;
  for (const axleX of [-29.5, 30.5]) {
    for (const wheelY of [-25, 19.8]) {
      roundedRect(ctx, x, y, axleX - 7, wheelY, 14, 5.2, 2.2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Large rear wing is drawn around the same origin; it never changes the pivot.
  ctx.fillStyle = skin.secondaryColor;
  ctx.strokeStyle = '#071521';
  ctx.lineWidth = stroke * 1.15;
  polygon([[-49, -24.5], [-45.5, -24.5], [-45.5, 24.5], [-49, 24.5]]);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#123987';
  roundedRect(ctx, x, y, -50.5, -25.5, 6, 2.8, 0.7); ctx.fill();
  roundedRect(ctx, x, y, -50.5, 22.7, 6, 2.8, 0.7); ctx.fill();
  ctx.fillStyle = '#172638';
  roundedRect(ctx, x, y, -45.7, -15.5, 4.4, 2.2, 0.7); ctx.fill();
  roundedRect(ctx, x, y, -45.7, 13.3, 4.4, 2.2, 0.7); ctx.fill();

  // Main silhouette and metallic cross-body shading.
  const bodyMetal = ctx.createLinearGradient(0, y(-24), 0, y(24));
  bodyMetal.addColorStop(0, '#60788f');
  bodyMetal.addColorStop(0.22, '#e4edf5');
  bodyMetal.addColorStop(0.52, skin.primaryColor);
  bodyMetal.addColorStop(0.82, '#d4e0ea');
  bodyMetal.addColorStop(1, '#566f87');
  polygon(BODY);
  ctx.fillStyle = bodyMetal;
  ctx.fill();
  ctx.strokeStyle = '#071521';
  ctx.lineWidth = stroke * 1.25;
  ctx.stroke();

  // Rear deck and hood keep the long-hood / compact-cabin proportions.
  ctx.beginPath();
  ctx.moveTo(x(-48), y(-15));
  ctx.quadraticCurveTo(x(-42), y(-19), x(-34), y(-18.5));
  ctx.lineTo(x(-31), y(-13));
  ctx.lineTo(x(-31), y(13));
  ctx.lineTo(x(-34), y(18.5));
  ctx.quadraticCurveTo(x(-42), y(19), x(-48), y(15));
  ctx.closePath();
  ctx.fillStyle = '#8499ae';
  ctx.fill();
  ctx.strokeStyle = '#40566c';
  ctx.lineWidth = stroke;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x(19), y(-15.3));
  ctx.quadraticCurveTo(x(34), y(-18.3), x(44), y(-15.5));
  ctx.quadraticCurveTo(x(49), y(-12), x(50), y(-7));
  ctx.lineTo(x(50), y(7));
  ctx.quadraticCurveTo(x(49), y(12), x(44), y(15.5));
  ctx.quadraticCurveTo(x(34), y(18.3), x(19), y(15.3));
  ctx.lineTo(x(16), y(10));
  ctx.lineTo(x(16), y(-10));
  ctx.closePath();
  ctx.fillStyle = '#c2d0dd';
  ctx.fill();
  ctx.stroke();

  // Two broad hood stripes and lower body color zones survive the 60 px gate.
  ctx.fillStyle = skin.secondaryColor;
  polygon([[18, -7], [49, -6.3], [50, -1.8], [18, -2.3]]); ctx.fill();
  polygon([[18, 2.3], [50, 1.8], [49, 6.3], [18, 7]]); ctx.fill();
  polygon([[-42, -20.1], [14, -19.6], [20, -17.4], [-34, -17.2]]); ctx.fill();
  polygon([[-42, 20.1], [14, 19.6], [20, 17.4], [-34, 17.2]]); ctx.fill();

  // Dark cabin mass with distinct rear glass, roof and windshield.
  ctx.beginPath();
  ctx.moveTo(x(-34), 0);
  ctx.quadraticCurveTo(x(-34), y(-15), x(-29), y(-18));
  ctx.lineTo(x(8), y(-17.3));
  ctx.quadraticCurveTo(x(17), y(-16), x(21), y(-9));
  ctx.lineTo(x(21), y(9));
  ctx.quadraticCurveTo(x(17), y(16), x(8), y(17.3));
  ctx.lineTo(x(-29), y(18));
  ctx.quadraticCurveTo(x(-34), y(15), x(-34), 0);
  ctx.closePath();
  ctx.fillStyle = '#07131f';
  ctx.fill();
  ctx.strokeStyle = '#071521';
  ctx.lineWidth = stroke * 1.15;
  ctx.stroke();

  const glass = ctx.createLinearGradient(x(-32), 0, x(20), 0);
  glass.addColorStop(0, '#0a1725');
  glass.addColorStop(0.58, '#10283e');
  glass.addColorStop(1, '#245474');
  polygon([[-32, -12], [-29, -15], [-22, -15.2], [-18, -11], [-18, 11], [-22, 15.2], [-29, 15], [-32, 12]]);
  ctx.fillStyle = glass; ctx.fill();
  ctx.strokeStyle = '#40566c'; ctx.lineWidth = stroke; ctx.stroke();
  polygon([[4, -14.2], [10, -15.2], [16.5, -13.2], [19.5, -8.5], [19.5, 8.5], [16.5, 13.2], [10, 15.2], [4, 14.2], [1, 10.5], [1, -10.5]]);
  ctx.fillStyle = glass; ctx.fill(); ctx.stroke();

  polygon([[-21, -11.4], [3, -10.7], [5, -7.5], [5, 7.5], [3, 10.7], [-21, 11.4], [-23, 8.2], [-23, -8.2]]);
  ctx.fillStyle = '#b7c8d8';
  ctx.fill();
  ctx.stroke();

  // Two major hood vents.
  ctx.fillStyle = '#0b1824';
  polygon([[31, -13.2], [40, -12.3], [38, -9.2], [30, -9.8]]); ctx.fill();
  polygon([[31, 13.2], [40, 12.3], [38, 9.2], [30, 9.8]]); ctx.fill();

  // Wheel arch rhythm is deliberately thicker than the photographic reference.
  ctx.strokeStyle = '#263b4e';
  ctx.lineWidth = stroke * 1.55;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x(-38), y(20 * side));
    ctx.quadraticCurveTo(x(-30), y(25 * side), x(-21), y(20 * side));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x(22), y(20 * side));
    ctx.quadraticCurveTo(x(30), y(25 * side), x(40), y(20 * side));
    ctx.stroke();
  }

  // Cyan/white headlight signature and compact red tail lamps.
  ctx.shadowColor = '#00a8ff';
  ctx.shadowBlur = Math.max(2, L * 0.055);
  ctx.fillStyle = '#cffbff';
  ctx.strokeStyle = '#00a8ff';
  ctx.lineWidth = stroke;
  polygon([[43, -17], [48, -14], [49.6, -9], [46.5, -9.8], [42, -13.2]]); ctx.fill(); ctx.stroke();
  polygon([[43, 17], [48, 14], [49.6, 9], [46.5, 9.8], [42, 13.2]]); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ff314d';
  ctx.strokeStyle = '#5a0a19';
  for (const tailY of [-12.5, 12.5]) {
    ctx.beginPath();
    ctx.ellipse(x(-47.2), y(tailY), x(2), y(3.2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Sparse highlights replace photographic seams that disappear at game scale.
  ctx.strokeStyle = 'rgba(235, 247, 255, 0.78)';
  ctx.lineWidth = stroke * 0.72;
  ctx.beginPath(); ctx.moveTo(x(23), y(-13)); ctx.quadraticCurveTo(x(38), y(-15), x(46), y(-11)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x(23), y(13)); ctx.quadraticCurveTo(x(38), y(15), x(46), y(11)); ctx.stroke();

  ctx.restore();
}

