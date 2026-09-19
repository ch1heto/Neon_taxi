import type { TrafficCar, TrafficVehicleType } from '../types/game';

export interface TrafficVehicleProfile {
  type: TrafficVehicleType;
  length: number;
  width: number;
  speedModifier: number;
  spawnWeight: number;
}

export const TRAFFIC_VEHICLE_PROFILES: Readonly<Record<TrafficVehicleType, TrafficVehicleProfile>> = Object.freeze({
  compact: Object.freeze({ type: 'compact', length: 44, width: 23, speedModifier: 1.00, spawnWeight: 5 }),
  sedan: Object.freeze({ type: 'sedan', length: 48, width: 24, speedModifier: 1.00, spawnWeight: 5 }),
  sport: Object.freeze({ type: 'sport', length: 49, width: 23, speedModifier: 1.08, spawnWeight: 1 }),
  luxury: Object.freeze({ type: 'luxury', length: 54, width: 26, speedModifier: 1.02, spawnWeight: 2 }),
  suv: Object.freeze({ type: 'suv', length: 52, width: 27, speedModifier: 0.98, spawnWeight: 3 }),
  van: Object.freeze({ type: 'van', length: 56, width: 27, speedModifier: 0.95, spawnWeight: 1 }),
  truck: Object.freeze({ type: 'truck', length: 58, width: 28, speedModifier: 0.91, spawnWeight: 1 }),
  taxi: Object.freeze({ type: 'taxi', length: 49, width: 24, speedModifier: 1.03, spawnWeight: 2 }),
});

export const TRAFFIC_VEHICLE_TYPES = Object.freeze(Object.keys(TRAFFIC_VEHICLE_PROFILES) as TrafficVehicleType[]);

export const TRAFFIC_VEHICLE_SPAWN_POOL: readonly TrafficVehicleType[] = Object.freeze(
  TRAFFIC_VEHICLE_TYPES.flatMap(type => Array.from(
    { length: TRAFFIC_VEHICLE_PROFILES[type].spawnWeight },
    () => type,
  )),
);

export const TRAFFIC_COLOR_PALETTE = Object.freeze([
  { body: '#e5e7eb', glow: '#ffffff' }, // white
  { body: '#111827', glow: '#64748b' }, // black
  { body: '#64748b', glow: '#94a3b8' }, // gray
  { body: '#cbd5e1', glow: '#f8fafc' }, // silver
  { body: '#2563eb', glow: '#60a5fa' }, // blue
  { body: '#0891b2', glow: '#22d3ee' }, // cyan
  { body: '#dc2626', glow: '#fb7185' }, // red
  { body: '#eab308', glow: '#fde047' }, // yellow
  { body: '#16a34a', glow: '#4ade80' }, // green
  { body: '#7e22ce', glow: '#c084fc' }, // purple
  { body: '#ea580c', glow: '#fb923c' }, // orange
  { body: '#334155', glow: '#94a3b8' }, // graphite
]);

export function getTrafficVehicleProfile(type: TrafficVehicleType): TrafficVehicleProfile {
  return TRAFFIC_VEHICLE_PROFILES[type];
}

function traceBody(ctx: CanvasRenderingContext2D, type: TrafficVehicleType, length: number, width: number) {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  ctx.beginPath();
  if (type === 'sport') {
    ctx.moveTo(-halfLength, -halfWidth * 0.72);
    ctx.lineTo(halfLength * 0.72, -halfWidth);
    ctx.lineTo(halfLength, -halfWidth * 0.5);
    ctx.lineTo(halfLength, halfWidth * 0.5);
    ctx.lineTo(halfLength * 0.72, halfWidth);
    ctx.lineTo(-halfLength, halfWidth * 0.72);
  } else if (type === 'compact') {
    ctx.moveTo(-halfLength, -halfWidth);
    ctx.lineTo(halfLength * 0.68, -halfWidth);
    ctx.lineTo(halfLength, -halfWidth * 0.56);
    ctx.lineTo(halfLength, halfWidth * 0.56);
    ctx.lineTo(halfLength * 0.68, halfWidth);
    ctx.lineTo(-halfLength, halfWidth);
  } else if (type === 'van' || type === 'suv') {
    ctx.moveTo(-halfLength, -halfWidth);
    ctx.lineTo(halfLength * 0.72, -halfWidth);
    ctx.lineTo(halfLength, -halfWidth * 0.72);
    ctx.lineTo(halfLength, halfWidth * 0.72);
    ctx.lineTo(halfLength * 0.72, halfWidth);
    ctx.lineTo(-halfLength, halfWidth);
  } else {
    ctx.moveTo(-halfLength, -halfWidth * 0.82);
    ctx.lineTo(-halfLength * 0.72, -halfWidth);
    ctx.lineTo(halfLength * 0.7, -halfWidth);
    ctx.lineTo(halfLength, -halfWidth * 0.58);
    ctx.lineTo(halfLength, halfWidth * 0.58);
    ctx.lineTo(halfLength * 0.7, halfWidth);
    ctx.lineTo(-halfLength * 0.72, halfWidth);
    ctx.lineTo(-halfLength, halfWidth * 0.82);
  }
  ctx.closePath();
}

function drawLights(ctx: CanvasRenderingContext2D, car: TrafficCar, length: number, width: number) {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#bae6fd';
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(halfLength - 3, -halfWidth * 0.76, 3, 4);
  ctx.fillRect(halfLength - 3, halfWidth * 0.76 - 4, 3, 4);
  ctx.shadowColor = car.isBraking ? '#ff0000' : '#dc2626';
  ctx.shadowBlur = car.isBraking ? 12 : 5;
  ctx.fillStyle = car.isBraking ? '#ff2d2d' : '#b91c1c';
  ctx.fillRect(-halfLength, -halfWidth * 0.76, 3, 5);
  ctx.fillRect(-halfLength, halfWidth * 0.76 - 5, 3, 5);
  ctx.shadowBlur = 0;
}

/** Lightweight top-down Canvas renderer. The caller owns translate/rotate/save/restore. */
export function renderTrafficVehicle(ctx: CanvasRenderingContext2D, car: TrafficCar): void {
  const type = car.modelType;
  const length = car.visualLength ?? car.length;
  const width = car.visualWidth ?? car.width;
  const halfLength = length / 2;
  const halfWidth = width / 2;

  // The old full-size fillRect exposed black corners beyond tapered bodies.
  // This soft footprint is visual-only and deliberately stays inside the body bounds.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
  ctx.beginPath();
  ctx.ellipse(3, 3, length * 0.47, width * 0.43, 0, 0, Math.PI * 2);
  ctx.fill();

  if (type === 'truck') {
    ctx.fillStyle = car.color;
    ctx.fillRect(-halfLength, -halfWidth, length * 0.55, width);
    ctx.strokeStyle = car.glowColor;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(-halfLength, -halfWidth, length * 0.55, width);
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.roundRect(length * 0.08, -halfWidth, length * 0.42, width, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#07111f';
    ctx.fillRect(length * 0.2, -width * 0.34, length * 0.16, width * 0.68);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    ctx.strokeRect(-halfLength + 4, -halfWidth + 4, length * 0.42, width - 8);
  } else {
    traceBody(ctx, type, length, width);
    ctx.fillStyle = car.color;
    ctx.shadowColor = car.glowColor;
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = car.glowColor;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = '#07111f';
    if (type === 'compact') {
      ctx.beginPath();
      ctx.roundRect(-length * 0.2, -width * 0.34, length * 0.43, width * 0.68, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.24)';
      ctx.fillRect(-length * 0.31, -width * 0.38, 2, width * 0.76);
    } else if (type === 'sport') {
      ctx.beginPath();
      ctx.moveTo(-length * 0.18, -width * 0.31);
      ctx.lineTo(length * 0.2, -width * 0.27);
      ctx.lineTo(length * 0.25, width * 0.27);
      ctx.lineTo(-length * 0.18, width * 0.31);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = car.glowColor;
      ctx.fillRect(-halfLength - 2, -width * 0.56, 3, width * 1.12);
    } else if (type === 'van') {
      ctx.fillRect(length * 0.18, -width * 0.34, length * 0.2, width * 0.68);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
      ctx.strokeRect(-length * 0.35, -width * 0.36, length * 0.42, width * 0.72);
    } else if (type === 'suv') {
      ctx.beginPath();
      ctx.roundRect(-length * 0.22, -width * 0.36, length * 0.48, width * 0.72, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      ctx.strokeRect(-length * 0.32, -width * 0.4, length * 0.66, width * 0.8);
    } else {
      const cabinScale = type === 'luxury' ? 0.46 : 0.42;
      ctx.beginPath();
      ctx.roundRect(-length * 0.18, -width * 0.34, length * cabinScale, width * 0.68, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.beginPath();
      ctx.moveTo(-length * 0.2, -width * 0.35);
      ctx.lineTo(-length * 0.2, width * 0.35);
      ctx.moveTo(length * 0.28, -width * 0.35);
      ctx.lineTo(length * 0.28, width * 0.35);
      ctx.stroke();
      if (type === 'luxury') {
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.5)';
        ctx.beginPath();
        ctx.moveTo(-length * 0.38, 0);
        ctx.lineTo(length * 0.4, 0);
        ctx.stroke();
      }
      if (type === 'taxi') {
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#fef08a';
        ctx.beginPath();
        ctx.roundRect(-4, -width * 0.18, 8, width * 0.36, 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  drawLights(ctx, car, length, width);
}
