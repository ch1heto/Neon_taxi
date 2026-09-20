import type { CityMap } from './CityMap';
import type { Order } from '../types/game';
import { getPassengerDefinition, getRideQualityRewardFactor } from './PassengerSystem';

export const EXPRESS_PROBABILITY = 0.35;
export const NORMAL_BASE_REWARD = 95;
export const NORMAL_REWARD_PER_WORLD_UNIT = 75 / 3000;
export const EXPRESS_MIN_MULTIPLIER = 0.65;
export const EXPRESS_MAX_MULTIPLIER = 1.70;
export const EXPRESS_REFERENCE_SPEED = 145;
export const EXPRESS_FIXED_BUFFER = 10;
export const RUSH_MAX_EARLY_MONEY_BONUS = 0.15;

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
  const safeDistance = Number.isFinite(routeDistance) ? Math.max(0, routeDistance) : 0;
  return Math.round(NORMAL_BASE_REWARD + safeDistance * NORMAL_REWARD_PER_WORLD_UNIT);
}

export function getExpressTargetTime(routeDistance: number): number {
  const safeDistance = Number.isFinite(routeDistance) ? Math.max(0, routeDistance) : 0;
  return safeDistance / EXPRESS_REFERENCE_SPEED + EXPRESS_FIXED_BUFFER;
}

export function getExpressEfficiency(rideElapsed: number, targetTime: number): number {
  const safeTarget = Number.isFinite(targetTime) && targetTime > 0 ? targetTime : EXPRESS_FIXED_BUFFER;
  const safeElapsed = Number.isFinite(rideElapsed) ? Math.max(0, rideElapsed) : safeTarget * 2.5;
  if (safeElapsed <= safeTarget) return 1;
  return Math.max(0, Math.min(1, 1 - (safeElapsed - safeTarget) / (safeTarget * 1.5)));
}

export function getRushEarlyRatio(rideElapsed: number, targetTime: number): number {
  if (!Number.isFinite(targetTime) || targetTime <= 0 || !Number.isFinite(rideElapsed)) return 0;
  const safeElapsed = Math.max(0, rideElapsed);
  if (safeElapsed >= targetTime) return 0;
  return Math.max(0, Math.min(1, (targetTime - safeElapsed) / targetTime));
}

export function getRushEarlyMoneyBonus(rideElapsed: number, targetTime: number): number {
  return getRushEarlyRatio(rideElapsed, targetTime) * RUSH_MAX_EARLY_MONEY_BONUS;
}

type OrderRewardInput = Pick<Order, 'orderType' | 'baseReward' | 'rideElapsed' | 'targetTime'> &
  Partial<Pick<Order, 'passengerType' | 'rideQuality'>>;

export function getOrderReward(order: OrderRewardInput): number {
  const baseReward = Number.isFinite(order.baseReward) ? Math.max(0, order.baseReward) : 0;
  const passenger = order.passengerType ? getPassengerDefinition(order.passengerType) : null;
  const passengerFactor = passenger?.rewardModifier ?? 1;
  const qualityFactor = passenger
    ? getRideQualityRewardFactor(passenger.id, order.rideQuality ?? 100)
    : 1;
  const timedFactor = order.orderType === 'express'
    ? EXPRESS_MIN_MULTIPLIER + (EXPRESS_MAX_MULTIPLIER - EXPRESS_MIN_MULTIPLIER) *
      getExpressEfficiency(order.rideElapsed, order.targetTime)
    : 1;
  const earlyFactor = order.passengerType === 'RUSH'
    ? 1 + getRushEarlyMoneyBonus(order.rideElapsed, order.targetTime)
    : 1;
  return Math.max(0, Math.round(baseReward * passengerFactor * qualityFactor * timedFactor * earlyFactor));
}

export function getEstimatedOrderReward(order: OrderRewardInput): number {
  return getOrderReward({
    ...order,
    rideElapsed: order.passengerType === 'RUSH' ? order.targetTime : 0,
    rideQuality: 100,
  });
}
