import type { Order } from '../types/game';
import { getPassengerDefinition } from './PassengerSystem';
import { getRushEarlyRatio } from './OrderEconomy';

export const MAX_DRIVER_LEVEL = 30;
export const PERFECT_RIDE_QUALITY = 92;
export const RUSH_MAX_EARLY_XP_BONUS = 0.1;

/** Cumulative XP required to begin a level. */
export function xpForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.min(MAX_DRIVER_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  const completedLevels = safeLevel - 1;
  return Math.round(completedLevels * 100 + 45 * Math.pow(completedLevels, 1.65));
}

export function levelFromXp(xp: number): number {
  const safeXp = Math.max(0, Number.isFinite(xp) ? Math.floor(xp) : 0);
  for (let level = MAX_DRIVER_LEVEL; level >= 1; level--) {
    if (safeXp >= xpForLevel(level)) return level;
  }
  return 1;
}

export function getDriverRank(level: number): string {
  const safeLevel = Math.max(1, Math.min(MAX_DRIVER_LEVEL, Math.floor(level)));
  if (safeLevel >= 30) return 'NEON LEGEND';
  if (safeLevel >= 25) return 'CITY LEGEND';
  if (safeLevel >= 20) return 'NIGHT ACE';
  if (safeLevel >= 15) return 'ELITE DRIVER';
  if (safeLevel >= 10) return 'PRO DRIVER';
  if (safeLevel >= 5) return 'STREET DRIVER';
  return 'ROOKIE';
}

export function getXpProgress(xp: number) {
  const safeXp = Math.max(0, Number.isFinite(xp) ? Math.floor(xp) : 0);
  const level = levelFromXp(safeXp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = level >= MAX_DRIVER_LEVEL ? currentLevelXp : xpForLevel(level + 1);
  return {
    level,
    rank: getDriverRank(level),
    current: safeXp - currentLevelXp,
    required: Math.max(0, nextLevelXp - currentLevelXp),
    total: safeXp,
    percent: level >= MAX_DRIVER_LEVEL ? 100 : Math.max(0, Math.min(100,
      ((safeXp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp)) * 100)),
  };
}

export function isPerfectRide(order: Pick<Order, 'rideQuality' | 'strongCollisions'>): boolean {
  return order.strongCollisions === 0 && order.rideQuality >= PERFECT_RIDE_QUALITY;
}

export function calculateOrderXp(order: Pick<Order,
  'routeDistance' | 'passengerType' | 'rideQuality' | 'strongCollisions' | 'rushSuccess'> &
  Partial<Pick<Order, 'rideElapsed' | 'targetTime'>>): number {
  const safeDistance = Number.isFinite(order.routeDistance) ? Math.max(0, order.routeDistance) : 0;
  const safeQuality = Number.isFinite(order.rideQuality) ? Math.max(0, Math.min(100, order.rideQuality)) : 0;
  const baseXp = 55 + Math.min(85, safeDistance / 80);
  const passenger = getPassengerDefinition(order.passengerType);
  const qualityFactor = order.passengerType === 'VIP' || order.passengerType === 'CAUTIOUS'
    ? 0.7 + safeQuality / 100 * 0.3
    : 1;
  const rushFactor = order.passengerType === 'RUSH' && order.rushSuccess ? 1.1 : 1;
  const rushEarlyFactor = order.passengerType === 'RUSH'
    ? 1 + getRushEarlyRatio(order.rideElapsed ?? Number.NaN, order.targetTime ?? Number.NaN) * RUSH_MAX_EARLY_XP_BONUS
    : 1;
  const perfectFactor = isPerfectRide(order) ? 1.15 : 1;
  return Math.max(0, Math.round(baseXp * passenger.xpModifier * qualityFactor * rushFactor * rushEarlyFactor * perfectFactor));
}
