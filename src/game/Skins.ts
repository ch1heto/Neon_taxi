import './CarVisualRenderers';
import { PRODUCTION_CAR_SKINS } from './CarCatalog';

/** Career-visible cars. Derived from the production subset of the universal catalog. */
export const CAR_SKINS = PRODUCTION_CAR_SKINS;

export const UPGRADE_PRICES = {
  speed: [100, 250, 600, 1500],
  handling: [80, 200, 500, 1200],
  dash: [120, 300, 750, 1800],
};

export function getUpgradeCost(type: 'speed' | 'handling' | 'dash', currentLevel: number): number | null {
  if (currentLevel >= 5) return null;
  return UPGRADE_PRICES[type][currentLevel - 1] ?? null;
}
