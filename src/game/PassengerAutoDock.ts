import type { Order, ParkingZone } from '../types/game';
import type { Car } from './Car';
import type { CityMap } from './CityMap';
import {
  closestPointOnSegment,
  normalizeAngle,
  vehicleCollisionCircles,
} from './geometry';

export const AUTO_DOCK_CAPTURE_DISTANCE = 110;
export const AUTO_DOCK_MAX_SPEED = 65;
export const AUTO_DOCK_DURATION = 0.55;
export const AUTO_DOCK_ROADSIDE_TOLERANCE = 18;
export const AUTO_DOCK_INDICATOR_DURATION = 1.25;

interface AutoDockTarget {
  key: string;
  zone: ParkingZone;
}

interface AutoDockMotion {
  targetKey: string;
  startX: number;
  startY: number;
  startAngle: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  elapsed: number;
}

export interface AutoDockUpdateResult {
  captured: boolean;
  controlsSuppressed: boolean;
  completed: boolean;
}

const smoothstep = (value: number) => value * value * (3 - 2 * value);

function nearestParallelAngle(currentAngle: number, parkingAngle: number): number {
  const forwardDelta = normalizeAngle(parkingAngle - currentAngle);
  const reverseDelta = normalizeAngle(parkingAngle + Math.PI - currentAngle);
  return currentAngle + (Math.abs(forwardDelta) <= Math.abs(reverseDelta) ? forwardDelta : reverseDelta);
}

export class PassengerAutoDock {
  private motion: AutoDockMotion | null = null;
  private currentTargetKey: string | null = null;
  private completedTargetKey: string | null = null;
  private indicatorTimer = 0;

  constructor(private readonly map: CityMap) {}

  public isActive(): boolean { return this.motion !== null; }
  public isIndicatorVisible(): boolean { return this.indicatorTimer > 0; }
  public getProgress(): number {
    return this.motion ? Math.min(1, this.motion.elapsed / AUTO_DOCK_DURATION) : 0;
  }

  public cancel() {
    this.motion = null;
    this.currentTargetKey = null;
    this.completedTargetKey = null;
    this.indicatorTimer = 0;
  }

  public update(dt: number, car: Car, order: Order | null): AutoDockUpdateResult {
    this.indicatorTimer = Math.max(0, this.indicatorTimer - Math.max(0, dt));
    const target = this.getTarget(order);
    if (!target) {
      this.cancel();
      return { captured: false, controlsSuppressed: false, completed: false };
    }

    if (this.currentTargetKey !== target.key) {
      this.motion = null;
      this.completedTargetKey = null;
      this.indicatorTimer = 0;
      this.currentTargetKey = target.key;
    }

    if (this.motion && this.motion.targetKey !== target.key) {
      this.cancel();
      return { captured: false, controlsSuppressed: false, completed: false };
    }

    if (!this.motion) {
      const distance = Math.hypot(target.zone.x - car.x, target.zone.y - car.y);
      if (this.completedTargetKey === target.key) {
        if (distance > AUTO_DOCK_CAPTURE_DISTANCE * 1.35) this.completedTargetKey = null;
        else return { captured: false, controlsSuppressed: false, completed: false };
      }
      if (!this.canCapture(car, target.zone)) {
        return { captured: false, controlsSuppressed: false, completed: false };
      }
      const targetAngle = nearestParallelAngle(car.angle, target.zone.angle);
      if (!this.isSweptPathSafe(car, target.zone.x, target.zone.y, targetAngle)) {
        return { captured: false, controlsSuppressed: false, completed: false };
      }
      this.motion = {
        targetKey: target.key,
        startX: car.x,
        startY: car.y,
        startAngle: car.angle,
        targetX: target.zone.x,
        targetY: target.zone.y,
        targetAngle,
        elapsed: 0,
      };
      this.indicatorTimer = AUTO_DOCK_INDICATOR_DURATION;
    }

    const captured = this.motion.elapsed === 0;
    this.motion.elapsed = Math.min(AUTO_DOCK_DURATION, this.motion.elapsed + Math.max(0, dt));
    const progress = this.motion.elapsed / AUTO_DOCK_DURATION;
    const eased = smoothstep(progress);
    car.x = this.motion.startX + (this.motion.targetX - this.motion.startX) * eased;
    car.y = this.motion.startY + (this.motion.targetY - this.motion.startY) * eased;
    car.angle = normalizeAngle(this.motion.startAngle +
      normalizeAngle(this.motion.targetAngle - this.motion.startAngle) * eased);
    car.vx = 0;
    car.vy = 0;
    car.speed = 0;
    car.angularVelocity = 0;

    if (progress < 1) {
      return { captured, controlsSuppressed: true, completed: false };
    }

    this.completedTargetKey = this.motion.targetKey;
    this.motion = null;
    return { captured, controlsSuppressed: true, completed: true };
  }

  private getTarget(order: Order | null): AutoDockTarget | null {
    if (!order || (order.status !== 'pickup' && order.status !== 'in_transit')) return null;
    const zoneId = order.status === 'pickup' ? order.pickupZoneId : order.destinationZoneId;
    const zone = this.map.parkingZones.find(candidate => candidate.id === zoneId);
    if (!zone) return null;
    return {
      key: `${order.id}:${order.status}:${zone.id}:${zone.x}:${zone.y}:${zone.angle}`,
      zone,
    };
  }

  private canCapture(car: Car, zone: ParkingZone): boolean {
    if (Math.hypot(zone.x - car.x, zone.y - car.y) > AUTO_DOCK_CAPTURE_DISTANCE) return false;
    if (Math.max(car.speed, Math.hypot(car.vx, car.vy)) > AUTO_DOCK_MAX_SPEED) return false;

    const road = this.map.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId);
    if (!road) return false;
    const roadCenter = closestPointOnSegment(
      zone,
      { x: road.x1, y: road.y1 },
      { x: road.x2, y: road.y2 },
    );
    const outwardX = zone.x - roadCenter.x;
    const outwardY = zone.y - roadCenter.y;
    const outwardLength = Math.hypot(outwardX, outwardY) || 1;
    const outwardOffset = ((car.x - zone.x) * outwardX + (car.y - zone.y) * outwardY) / outwardLength;
    return outwardOffset <= AUTO_DOCK_ROADSIDE_TOLERANCE;
  }

  private isSweptPathSafe(car: Car, targetX: number, targetY: number, targetAngle: number): boolean {
    const distance = Math.hypot(targetX - car.x, targetY - car.y);
    const angleDelta = normalizeAngle(targetAngle - car.angle);
    const samples = Math.max(8, Math.ceil(distance / 6), Math.ceil(Math.abs(angleDelta) / (Math.PI / 24)));
    for (let index = 0; index <= samples; index++) {
      const progress = index / samples;
      const pose = {
        x: car.x + (targetX - car.x) * progress,
        y: car.y + (targetY - car.y) * progress,
        angle: normalizeAngle(car.angle + angleDelta * progress),
        length: car.length,
        width: car.width,
      };
      if (this.map.checkVehicleCollision(pose)) return false;
      if (vehicleCollisionCircles(pose).some(circle =>
        Boolean(this.map.checkIslandBoundary(circle.x, circle.y, circle.radius)))) return false;
      if (this.map.checkTrafficCollision(pose)) return false;
    }
    return true;
  }
}
