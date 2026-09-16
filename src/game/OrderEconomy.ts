import type { CityMap } from './CityMap';
import type { Order } from '../types/game';

export const EXPRESS_PROBABILITY = 0.35;
export const NORMAL_BASE_REWARD = 95;
export const NORMAL_REWARD_PER_WORLD_UNIT = 75 / 3000;
export const EXPRESS_MIN_MULTIPLIER = 0.65;
export const EXPRESS_MAX_MULTIPLIER = 1.70;
export const EXPRESS_REFERENCE_SPEED = 145;
export const EXPRESS_FIXED_BUFFER = 10;

export function polylineDistance(points: readonly { x: number; y: number }[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return distance;
}

export function getRouteDistance(map: CityMap, from: { x: number; y: number; angle?: number }, to: { x: number; y: number }): number {
  return polylineDistance(map.findGpsRoute(from.x, from.y, to.x, to.y, from.angle ?? 0).points);
}

export function getNormalReward(routeDistance: number): number {
  return Math.round(NORMAL_BASE_REWARD + routeDistance * NORMAL_REWARD_PER_WORLD_UNIT);
}

export function getExpressTargetTime(routeDistance: number): number {
  return routeDistance / EXPRESS_REFERENCE_SPEED + EXPRESS_FIXED_BUFFER;
}

export function getExpressEfficiency(rideElapsed: number, targetTime: number): number {
  if (rideElapsed <= targetTime) return 1;
  return Math.max(0, Math.min(1, 1 - (rideElapsed - targetTime) / (targetTime * 1.5)));
}

export function getOrderReward(order: Pick<Order, 'orderType' | 'baseReward' | 'rideElapsed' | 'targetTime'>): number {
  if (order.orderType === 'normal') return order.baseReward;
  const efficiency = getExpressEfficiency(order.rideElapsed, order.targetTime);
  return Math.round(order.baseReward * (EXPRESS_MIN_MULTIPLIER +
    (EXPRESS_MAX_MULTIPLIER - EXPRESS_MIN_MULTIPLIER) * efficiency));
}
