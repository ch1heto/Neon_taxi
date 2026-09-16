import { Car, type DrivingSurface } from './Car';
import type { CarSkin } from '../types/game';
import { closestPointOnSegment, vehicleCollisionCircles, type Contact } from './geometry';

type Point = { x: number; y: number };
export const TEST_DRIVE_ASPHALT_HALF_WIDTH = 94;
export type TrackProjection = {
  closest: Point;
  segment: number;
  distance: number;
  tangent: Point;
  normal: Point;
  progress: number;
};
const CONTROL_POINTS: Point[] = [
  { x: 480, y: 800 }, { x: 4500, y: 800 }, { x: 5200, y: 950 },
  { x: 5500, y: 1550 }, { x: 5300, y: 2200 }, { x: 4800, y: 2650 },
  { x: 4500, y: 2700 }, { x: 2600, y: 2700 }, { x: 2400, y: 2500 },
  { x: 2100, y: 2800 }, { x: 1700, y: 3000 }, { x: 600, y: 3000 },
  { x: 250, y: 2600 }, { x: 250, y: 1600 }, { x: 300, y: 800 },
];

function makeClosedTrack(): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < CONTROL_POINTS.length; index++) {
    const prev = CONTROL_POINTS[(index - 1 + CONTROL_POINTS.length) % CONTROL_POINTS.length];
    const current = CONTROL_POINTS[index];
    const next = CONTROL_POINTS[(index + 1) % CONTROL_POINTS.length];
    const incomingLength = Math.hypot(current.x - prev.x, current.y - prev.y);
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
    const incomingDirection = { x: (current.x - prev.x) / incomingLength, y: (current.y - prev.y) / incomingLength };
    const outgoingDirection = { x: (next.x - current.x) / outgoingLength, y: (next.y - current.y) / outgoingLength };
    const straight = incomingDirection.x * outgoingDirection.x + incomingDirection.y * outgoingDirection.y > 0.999;
    const radius = straight ? 0 : Math.min(360, incomingLength / 2.5, outgoingLength / 2.5);
    const entry = { x: current.x - incomingDirection.x * radius, y: current.y - incomingDirection.y * radius };
    const exit = { x: current.x + outgoingDirection.x * radius, y: current.y + outgoingDirection.y * radius };
    points.push(entry);
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      points.push({
        x: (1 - t) ** 2 * entry.x + 2 * (1 - t) * t * current.x + t ** 2 * exit.x,
        y: (1 - t) ** 2 * entry.y + 2 * (1 - t) * t * current.y + t ** 2 * exit.y,
      });
    }
  }
  points.push({ ...points[0] });
  return points;
}

export class TestDriveTrack implements DrivingSurface {
  readonly width = 5900;
  readonly height = 3400;
  readonly start = { x: 480, y: 800, angle: 0 };
  readonly points = makeClosedTrack();
  readonly length: number;
  private cumulative: number[] = [0];

  constructor() {
    for (let index = 1; index < this.points.length; index++) {
      this.cumulative.push(this.cumulative[index - 1] + Math.hypot(
        this.points[index].x - this.points[index - 1].x,
        this.points[index].y - this.points[index - 1].y));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
  }

  checkVehicleCollision(vehicle: { x: number; y: number; angle: number; length: number; width: number }): Contact | null {
    let strongest: Contact | null = null;
    for (const circle of vehicleCollisionCircles(vehicle)) {
      const projection = this.project(circle);
      const overlap = projection.distance + circle.radius - TEST_DRIVE_ASPHALT_HALF_WIDTH;
      if (overlap <= 0 || (strongest && strongest.overlap >= overlap)) continue;
      // The road is the union of the asphalt-width capsules around the centerline.
      // Its contact normal points toward the closest point on that centerline.
      const inwardX = projection.distance > 1e-6
        ? (projection.closest.x - circle.x) / projection.distance : -projection.normal.x;
      const inwardY = projection.distance > 1e-6
        ? (projection.closest.y - circle.y) / projection.distance : -projection.normal.y;
      strongest = { hit: true, normalX: inwardX, normalY: inwardY, overlap };
    }
    return strongest;
  }
  checkIslandBoundary(_x: number, _y: number, _radius: number) { return null; }
  checkTrafficCollision(_vehicle: { x: number; y: number; angle: number; length: number; width: number }) { return null; }

  project(point: Point): TrackProjection {
    let bestDistance = Infinity;
    let bestProgress = 0;
    let bestClosest = this.points[0];
    let bestSegment = 0;
    let bestTangent = { x: 1, y: 0 };
    for (let index = 1; index < this.points.length; index++) {
      const a = this.points[index - 1];
      const b = this.points[index];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength < 1e-6) continue;
      const candidate = closestPointOnSegment(point, a, b);
      if (candidate.distance < bestDistance) {
        bestDistance = candidate.distance;
        bestClosest = { x: candidate.x, y: candidate.y };
        bestSegment = index - 1;
        bestTangent = { x: dx / segmentLength, y: dy / segmentLength };
        bestProgress = this.cumulative[index - 1] + segmentLength * candidate.t;
      }
    }
    return { closest: bestClosest, segment: bestSegment, distance: bestDistance,
      tangent: bestTangent, normal: { x: -bestTangent.y, y: bestTangent.x }, progress: bestProgress };
  }

  private renderEdge(ctx: CanvasRenderingContext2D, side: number) {
    // Offset the same centerline used by collision; rounded joins soften sharp bends.
    const last = this.points.length - 1;
    ctx.beginPath();
    for (let index = 0; index <= last; index++) {
      const vertex = this.points[index];
      const previous = this.points[(index - 1 + last) % last];
      const next = this.points[(index + 1) % last];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy);
      const offsetX = length > 1e-6 ? -dy / length * TEST_DRIVE_ASPHALT_HALF_WIDTH * side : 0;
      const offsetY = length > 1e-6 ? dx / length * TEST_DRIVE_ASPHALT_HALF_WIDTH * side : 0;
      if (index === 0) ctx.moveTo(vertex.x + offsetX, vertex.y + offsetY);
      else ctx.lineTo(vertex.x + offsetX, vertex.y + offsetY);
    }
    ctx.closePath();
    ctx.strokeStyle = side > 0 ? '#22d3ee' : '#f472b6';
    ctx.lineWidth = 4;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.68)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number) {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(cameraX - viewWidth / 2, cameraY - viewHeight / 2, viewWidth, viewHeight);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (const point of this.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth = 226;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 25;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#233447';
    ctx.lineWidth = 205;
    ctx.stroke();
    ctx.strokeStyle = '#111c2e';
    ctx.lineWidth = TEST_DRIVE_ASPHALT_HALF_WIDTH * 2;
    ctx.stroke();
    this.renderEdge(ctx, 1);
    this.renderEdge(ctx, -1);
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (const point of this.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = 'rgba(250,204,21,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([36, 30]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e2e8f0';
    for (let y = this.start.y - 85; y < this.start.y + 85; y += 20) {
      ctx.fillRect(this.start.x - 8, y, 8, 10);
      ctx.fillRect(this.start.x, y + 10, 8, 10);
    }
    ctx.fillStyle = '#67e8f9';
    ctx.font = '900 42px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('NEON TEST DRIVE', 2900, 550);
    ctx.font = 'bold 22px system-ui';
    ctx.fillText('LONG STRAIGHT 4 KM', 2800, 680);
    ctx.fillStyle = '#fda4af';
    ctx.fillText('S-CURVES', 2150, 2300);
    ctx.fillText('BRAKE ZONE', 650, 2450);
    ctx.fillStyle = '#67e8f9';
    for (let distance = 500; distance < this.length; distance += 500) {
      const index = this.cumulative.findIndex(value => value >= distance);
      if (index < 1) continue;
      const a = this.points[index - 1];
      const b = this.points[index];
      const segmentLength = this.cumulative[index] - this.cumulative[index - 1];
      const t = (distance - this.cumulative[index - 1]) / segmentLength;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const normalX = -(b.y - a.y) / segmentLength;
      const normalY = (b.x - a.x) / segmentLength;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + normalX * 110 * side, y + normalY * 110 * side, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export class TestDriveSession {
  readonly track = new TestDriveTrack();
  readonly skin: CarSkin;
  readonly car: Car;
  elapsed = 0;
  maxSpeedKmh = 0;
  zeroToHundred: number | null = null;
  lapElapsed = 0;
  bestLap: number | null = null;
  resetGeneration = 0;
  emergencyResetCount = 0;
  private accelerationStart: number | null = null;
  private stoppedFor = 0;
  private lapTravel = 0;
  private previousProgress = 0;

  constructor(skin: CarSkin) {
    this.skin = skin;
    this.car = new Car(this.track.start.x, this.track.start.y);
    this.car.angle = this.track.start.angle;
    this.car.applyUpgrades({ speedLevel: 1, handlingLevel: 1, dashLevel: 1 }, skin);
  }

  reset() {
    this.car.resetForTestDrive(this.track.start.x, this.track.start.y, this.track.start.angle);
    this.resetGeneration++;
    this.lapElapsed = 0;
    this.lapTravel = 0;
    this.previousProgress = 0;
    this.accelerationStart = null;
    this.stoppedFor = 0;
    this.zeroToHundred = null;
  }

  update(dt: number, input: { forward: number; reverse: number; steer: number; brake: boolean; dash: boolean }) {
    const before = { x: this.car.x, y: this.car.y };
    const oldSpeed = this.car.speed / 3;
    this.car.update(dt, input, this.track, this.skin);
    // Contact keeps ordinary driving in bounds; this only catches corrupt/outlier state.
    if (this.track.project(this.car).distance > 1000) {
      this.emergencyResetCount++;
      this.reset();
      return;
    }
    this.elapsed += dt;
    this.lapElapsed += dt;
    const speedKmh = this.car.speed / 3;
    this.maxSpeedKmh = Math.max(this.maxSpeedKmh, speedKmh);
    if (speedKmh <= 2) {
      this.stoppedFor += dt;
      if (this.stoppedFor >= 0.5) this.accelerationStart = null;
    } else {
      if (oldSpeed <= 2 && this.accelerationStart === null) {
        this.accelerationStart = this.elapsed;
        this.zeroToHundred = null;
      }
      this.stoppedFor = 0;
    }
    if (this.accelerationStart !== null && this.zeroToHundred === null && speedKmh >= 100) {
      this.zeroToHundred = this.elapsed - this.accelerationStart;
    }
    this.lapTravel += Math.hypot(this.car.x - before.x, this.car.y - before.y);
    const progress = this.track.project(this.car).progress;
    if (this.previousProgress > this.track.length * 0.85 && progress < this.track.length * 0.15 &&
      this.lapTravel >= this.track.length * 0.75 && speedKmh > 5) {
      this.bestLap = this.bestLap === null ? this.lapElapsed : Math.min(this.bestLap, this.lapElapsed);
      this.lapElapsed = 0;
      this.lapTravel = 0;
    }
    this.previousProgress = progress;
  }
}
