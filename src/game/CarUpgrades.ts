import type { CarUpgradeStats, PlayerSaveData } from '../types/game';

export const DEFAULT_CAR_UPGRADES: Readonly<CarUpgradeStats> = Object.freeze({
  speedLevel: 1,
  handlingLevel: 1,
  dashLevel: 1,
});

export function clampCarUpgradeLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

export function sanitizeCarUpgradeStats(value: unknown): CarUpgradeStats {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<CarUpgradeStats>
    : {};
  return {
    speedLevel: clampCarUpgradeLevel(source.speedLevel),
    handlingLevel: clampCarUpgradeLevel(source.handlingLevel),
    dashLevel: clampCarUpgradeLevel(source.dashLevel),
  };
}

export function getCarUpgradeStats(
  saveData: Pick<PlayerSaveData, 'carUpgrades' | 'selectedSkinId'>,
  carId = saveData.selectedSkinId,
): CarUpgradeStats {
  return sanitizeCarUpgradeStats(saveData.carUpgrades?.[carId]);
}

export function cloneCarUpgrades(upgrades: PlayerSaveData['carUpgrades']): PlayerSaveData['carUpgrades'] {
  return Object.fromEntries(Object.entries(upgrades).map(([carId, stats]) => [
    carId,
    sanitizeCarUpgradeStats(stats),
  ]));
}
