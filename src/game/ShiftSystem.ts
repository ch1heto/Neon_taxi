import type { PlayerSaveData, ShiftRating } from '../types/game';
import { levelFromXp } from './DriverProgression';

export interface ShiftStats {
  startedAt: number;
  startingDriverXp: number;
  completedOrders: number;
  earnings: number;
  xpEarned: number;
  collisions: number;
  rejectedOrders: number;
  perfectRides: number;
  vipRides: number;
  rushSuccesses: number;
  totalRideQuality: number;
  totalVipQuality: number;
}

export interface ShiftResult {
  stats: ShiftStats;
  averageQuality: number;
  score: number;
  rating: ShiftRating;
  completionBonusXp: number;
  totalXpEarned: number;
  durationSeconds: number;
  levelBefore: number;
  levelAfter: number;
  driverXpAfter: number;
}

export function createShiftStats(startingDriverXp = 0, startedAt = Date.now()): ShiftStats {
  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    startingDriverXp: Number.isFinite(startingDriverXp) ? Math.max(0, startingDriverXp) : 0,
    completedOrders: 0,
    earnings: 0, xpEarned: 0, collisions: 0, rejectedOrders: 0,
    perfectRides: 0, vipRides: 0, rushSuccesses: 0,
    totalRideQuality: 0, totalVipQuality: 0,
  };
}

export function getAverageRideQuality(stats: ShiftStats): number {
  const completedOrders = Number.isFinite(stats.completedOrders) ? Math.max(0, stats.completedOrders) : 0;
  const totalQuality = Number.isFinite(stats.totalRideQuality) ? Math.max(0, stats.totalRideQuality) : 0;
  return completedOrders > 0
    ? Math.max(0, Math.min(100, totalQuality / completedOrders))
    : 0;
}

export function calculateShiftScore(stats: ShiftStats): number {
  const safe = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const completedOrders = safe(stats.completedOrders);
  const perfectRides = safe(stats.perfectRides);
  const collisions = safe(stats.collisions);
  const rejectedOrders = safe(stats.rejectedOrders);
  const rushSuccesses = safe(stats.rushSuccesses);
  const vipRides = safe(stats.vipRides);
  const averageQuality = completedOrders > 0
    ? Math.max(0, Math.min(100, safe(stats.totalRideQuality) / completedOrders)) : 0;
  const perfectRatio = completedOrders > 0 ? Math.min(1, perfectRides / completedOrders) : 0;
  const vipAverage = vipRides > 0 ? Math.min(100, safe(stats.totalVipQuality) / vipRides) : 0;
  const raw = 35
    + Math.min(25, completedOrders * 5)
    + averageQuality * 0.25
    + perfectRatio * 10
    + Math.min(6, rushSuccesses * 2)
    + (vipRides > 0 ? vipAverage * 0.04 : 0)
    - collisions * 5
    - rejectedOrders * 6;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export function scoreToRating(score: number): ShiftRating {
  const safeScore = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  if (safeScore >= 90) return 'S';
  if (safeScore >= 80) return 'A';
  if (safeScore >= 65) return 'B';
  if (safeScore >= 50) return 'C';
  return 'D';
}

export const SHIFT_XP_BONUS: Readonly<Record<ShiftRating, number>> = Object.freeze({
  S: 0.2, A: 0.12, B: 0.07, C: 0.03, D: 0,
});

export function completeShift(
  saveData: PlayerSaveData,
  stats: ShiftStats,
  endedAt = Date.now(),
): { saveData: PlayerSaveData; result: ShiftResult } {
  const score = calculateShiftScore(stats);
  const rating = scoreToRating(score);
  const orderXp = Number.isFinite(stats.xpEarned) ? Math.max(0, stats.xpEarned) : 0;
  const completionBonusXp = Math.max(0, Math.round(orderXp * SHIFT_XP_BONUS[rating]));
  const driverXpAfter = Math.max(0, saveData.driverXp + completionBonusXp);
  return {
    saveData: {
      ...saveData,
      driverXp: driverXpAfter,
      totalShifts: saveData.totalShifts + 1,
      bestShiftScore: Math.max(saveData.bestShiftScore, score),
    },
    result: {
      stats: { ...stats },
      averageQuality: getAverageRideQuality(stats),
      score,
      rating,
      completionBonusXp,
      totalXpEarned: orderXp + completionBonusXp,
      durationSeconds: Number.isFinite(endedAt)
        ? Math.max(0, Math.round((endedAt - stats.startedAt) / 1000)) : 0,
      levelBefore: levelFromXp(stats.startingDriverXp),
      levelAfter: levelFromXp(driverXpAfter),
      driverXpAfter,
    },
  };
}
