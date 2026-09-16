export interface Point {
  x: number;
  y: number;
}

export interface Contact {
  hit: true;
  normalX: number;
  normalY: number;
  overlap: number;
}

export interface CollisionCircle extends Point {
  radius: number;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function orientationDifference(a: number, b: number): number {
  const delta = Math.abs(normalizeAngle(a - b));
  return Math.min(delta, Math.abs(Math.PI - delta));
}

export function closestPointOnSegment(
  point: Point,
  start: Point,
  end: Point,
): Point & { t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = start.x + dx * t;
  const y = start.y + dy * t;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

export function pointInRoadCorridor(
  point: Point,
  start: Point,
  end: Point,
  width: number,
  margin = 0,
): boolean {
  return closestPointOnSegment(point, start, end).distance <= width / 2 + margin;
}

export function pointInRotatedRect(
  point: Point,
  rect: Point & { width: number; height: number; angle: number },
  margin = 0,
): boolean {
  const cos = Math.cos(rect.angle);
  const sin = Math.sin(rect.angle);
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= rect.width / 2 + margin &&
    Math.abs(localY) <= rect.height / 2 + margin;
}

export function pointInRotatedEllipse(
  point: Point,
  ellipse: Point & { radiusX: number; radiusY: number; angle: number },
  margin = 0,
): boolean {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const dx = point.x - ellipse.x;
  const dy = point.y - ellipse.y;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const rx = Math.max(1, ellipse.radiusX + margin);
  const ry = Math.max(1, ellipse.radiusY + margin);
  return (localX * localX) / (rx * rx) + (localY * localY) / (ry * ry) <= 1;
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

export function closestPointOnPolygon(point: Point, polygon: Point[]): Point & { distance: number } {
  let best = { x: polygon[0].x, y: polygon[0].y, distance: Infinity };
  for (let i = 0; i < polygon.length; i++) {
    const candidate = closestPointOnSegment(point, polygon[i], polygon[(i + 1) % polygon.length]);
    if (candidate.distance < best.distance) best = candidate;
  }
  return best;
}

export function catmullRomClosed(controlPoints: Point[], samplesPerEdge = 8): Point[] {
  const result: Point[] = [];
  const count = controlPoints.length;
  for (let i = 0; i < count; i++) {
    const p0 = controlPoints[(i - 1 + count) % count];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % count];
    const p3 = controlPoints[(i + 2) % count];
    for (let sample = 0; sample < samplesPerEdge; sample++) {
      const t = sample / samplesPerEdge;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}

export function vehicleCollisionCircles(vehicle: {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
}): CollisionCircle[] {
  const radius = Math.max(5, vehicle.width * 0.42);
  const offset = Math.max(0, vehicle.length / 2 - radius);
  const dx = Math.cos(vehicle.angle) * offset;
  const dy = Math.sin(vehicle.angle) * offset;
  return [
    { x: vehicle.x - dx, y: vehicle.y - dy, radius },
    { x: vehicle.x, y: vehicle.y, radius },
    { x: vehicle.x + dx, y: vehicle.y + dy, radius },
  ];
}

export function vehicleFootprintSamples(vehicle: {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
}): Point[] {
  const halfLength = vehicle.length / 2;
  const halfWidth = vehicle.width / 2;
  const localPoints = [
    [-halfLength, -halfWidth], [-halfLength, halfWidth],
    [halfLength, -halfWidth], [halfLength, halfWidth],
    [0, 0], [halfLength, 0], [-halfLength, 0],
    [0, -halfWidth], [0, halfWidth],
  ];
  const cos = Math.cos(vehicle.angle);
  const sin = Math.sin(vehicle.angle);
  return localPoints.map(([x, y]) => ({
    x: vehicle.x + x * cos - y * sin,
    y: vehicle.y + x * sin + y * cos,
  }));
}

export function circleVsAxisAlignedRect(
  circle: CollisionCircle,
  rect: { x: number; y: number; width: number; height: number },
): Contact | null {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.width);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.height);
  let dx = circle.x - closestX;
  let dy = circle.y - closestY;
  const distance = Math.hypot(dx, dy);
  if (distance >= circle.radius) return null;

  if (distance > 1e-6) {
    return {
      hit: true,
      normalX: dx / distance,
      normalY: dy / distance,
      overlap: circle.radius - distance,
    };
  }

  const left = circle.x - rect.x;
  const right = rect.x + rect.width - circle.x;
  const top = circle.y - rect.y;
  const bottom = rect.y + rect.height - circle.y;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) { dx = -1; dy = 0; }
  else if (nearest === right) { dx = 1; dy = 0; }
  else if (nearest === top) { dx = 0; dy = -1; }
  else { dx = 0; dy = 1; }
  return { hit: true, normalX: dx, normalY: dy, overlap: circle.radius + nearest };
}

export function circleVsCircle(a: CollisionCircle, b: CollisionCircle): Contact | null {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distance = Math.hypot(dx, dy);
  const combined = a.radius + b.radius;
  if (distance >= combined) return null;
  return {
    hit: true,
    normalX: distance > 1e-6 ? dx / distance : 1,
    normalY: distance > 1e-6 ? dy / distance : 0,
    overlap: combined - distance,
  };
}

export function segmentIntersection(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): (Point & { ta: number; tb: number }) | null {
  const rX = b.x - a.x;
  const rY = b.y - a.y;
  const sX = d.x - c.x;
  const sY = d.y - c.y;
  const denominator = rX * sY - rY * sX;
  if (Math.abs(denominator) < 1e-8) return null;
  const cax = c.x - a.x;
  const cay = c.y - a.y;
  const ta = (cax * sY - cay * sX) / denominator;
  const tb = (cax * rY - cay * rX) / denominator;
  if (ta < -1e-6 || ta > 1 + 1e-6 || tb < -1e-6 || tb > 1 + 1e-6) return null;
  return { x: a.x + rX * ta, y: a.y + rY * ta, ta: clamp(ta, 0, 1), tb: clamp(tb, 0, 1) };
}

export function hashNoise(x: number, y: number, salt = 0): number {
  let value = Math.imul(Math.round(x) + salt * 101, 374761393) ^
    Math.imul(Math.round(y) - salt * 67, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
