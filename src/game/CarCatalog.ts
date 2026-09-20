import type { CarModelType, CarSkin } from '../types/game';
import lifecycleSource from './carLifecycle.json';
import { renderMazdaRX7FD } from './carVisuals/MazdaRX7FD';
import { renderNeonStreetGT as renderSkylineR34 } from './carVisuals/NeonStreetGT';
import { renderCityCruiserTaxi } from './carVisuals/CityCruiserTaxi';
import { renderMercedesAMG } from './carVisuals/MercedesAMG';
import {
  createSvgCarRenderer,
  LAMBORGHINI_SVG_VISUAL_SPEC,
  type CarVisualRenderer,
} from './carVisuals/SvgCarRenderer';

export type CarCatalogStatus = 'experimental' | 'production';

export interface CarLifecycleEntry {
  readonly status: CarCatalogStatus;
  readonly price: number;
  readonly requiredOrders: number;
}

export type CarLifecycleConfig = Readonly<Record<string, Readonly<CarLifecycleEntry>>>;

export type CarCatalogRenderer = Readonly<
  | { type: 'canvas'; draw?: CarVisualRenderer }
  | { type: 'svg'; assetUrl: string; draw: CarVisualRenderer }
>;

interface StaticCarDefinition extends Omit<CarSkin, 'price' | 'requiredOrders'> {
  readonly renderer: CarCatalogRenderer;
  /** Historical tuning origin only. Runtime physics always comes from this entry's numeric stats. */
  readonly physicsProvenance: string;
}

export interface CarCatalogEntry extends StaticCarDefinition, CarLifecycleEntry {}

function defineStaticCar(entry: StaticCarDefinition): Readonly<StaticCarDefinition> {
  return Object.freeze({ ...entry, renderer: Object.freeze({ ...entry.renderer }) });
}

function defineCatalogEntry(entry: CarCatalogEntry): Readonly<CarCatalogEntry> {
  return Object.freeze({ ...entry, renderer: Object.freeze({ ...entry.renderer }) });
}

const lamborghiniRenderer = createSvgCarRenderer(LAMBORGHINI_SVG_VISUAL_SPEC.assetUrl);

/** Visual identity and real base physics. Lifecycle/economy live only in carLifecycle.json. */
const STATIC_CAR_DEFINITIONS: readonly Readonly<StaticCarDefinition>[] = Object.freeze([
  defineStaticCar({
    id: 'cruiser', name: 'City Cruiser Taxi', modelType: 'sedan',
    renderer: { type: 'canvas' }, physicsProvenance: 'starter-balanced',
    description: 'Классический городской седан-такси. Надежный, сбалансированный, с шашечками на крыше.',
    primaryColor: '#facc15', secondaryColor: '#1e293b', glowColor: 'rgba(250, 204, 21, 0.4)',
    trailColor: 'rgba(250, 204, 21, 0.4)', length: 52, width: 28,
    maxSpeed: 340, acceleration: 380, braking: 620, steering: 3.2, grip: 0.86, durability: 1,
    dashPower: 340, dashCooldown: 4.2, speedBonus: 0, handlingBonus: 0,
  }),
  defineStaticCar({
    id: 'sport', name: 'Cyber GT Coupe', modelType: 'sport',
    renderer: { type: 'canvas' }, physicsProvenance: 'legacy-sport',
    description: 'Спортивное купе с широким антикрылом и низкой посадкой. Высокая скорость и резкий отклик.',
    primaryColor: '#06b6d4', secondaryColor: '#0f172a', glowColor: 'rgba(6, 182, 212, 0.5)',
    trailColor: 'rgba(6, 182, 212, 0.5)', length: 56, width: 30,
    maxSpeed: 392, acceleration: 475, braking: 690, steering: 3.75, grip: 0.82, durability: 0.85,
    dashPower: 390, dashCooldown: 3.7, speedBonus: 52, handlingBonus: 0.25,
  }),
  defineStaticCar({
    id: 'suv', name: 'Titan 4x4 Enforcer', modelType: 'suv',
    renderer: { type: 'canvas' }, physicsProvenance: 'legacy-suv',
    description: 'Бронированный внедорожник-такси. Массивный бампер, светодиодная люстра на крыше, устойчив к заносам.',
    primaryColor: '#f97316', secondaryColor: '#18181b', glowColor: 'rgba(249, 115, 22, 0.45)',
    trailColor: 'rgba(249, 115, 22, 0.4)', length: 62, width: 34,
    maxSpeed: 357, acceleration: 340, braking: 660, steering: 2.9, grip: 0.94, durability: 1.35,
    dashPower: 315, dashCooldown: 4.4, speedBonus: 17, handlingBonus: 0.08, armorBonus: 0.35,
  }),
  defineStaticCar({
    id: 'hyper', name: 'Veloce Hyper-V', modelType: 'hyper',
    renderer: { type: 'canvas' }, physicsProvenance: 'legacy-hyper',
    description: 'Гоночный прототип с каплевидным кокпитом и сдвоенными аэродинамическими килями. Молниеносный разгон.',
    primaryColor: '#ec4899', secondaryColor: '#020617', glowColor: 'rgba(236, 72, 153, 0.5)',
    trailColor: 'rgba(236, 72, 153, 0.5)', length: 60, width: 31,
    maxSpeed: 442, acceleration: 560, braking: 640, steering: 3.65, grip: 0.76, durability: 0.8,
    dashPower: 455, dashCooldown: 3.35, speedBonus: 102, handlingBonus: 0.18,
  }),
  defineStaticCar({
    id: 'skyline-r34', name: 'Missan Skylime HZR', modelType: 'skyline-r34',
    renderer: { type: 'canvas', draw: renderSkylineR34 }, physicsProvenance: 'sport-gt-tuning',
    description: 'Легендарное JDM-купе с серебристым кузовом, двойными синими полосами и большим GT-антикрылом.',
    primaryColor: '#A9BCD0', secondaryColor: '#0B4EDB', glowColor: 'rgba(0, 168, 255, 0.48)',
    trailColor: 'rgba(0, 168, 255, 0.46)', length: 52, width: 28,
    maxSpeed: 455, acceleration: 550, braking: 725, steering: 3.8, grip: 0.89, durability: 0.95,
    dashPower: 455, dashCooldown: 3.3, speedBonus: 115, handlingBonus: 0.32,
  }),
  defineStaticCar({
    id: 'aerocar', name: 'Phantom Blade VIP', modelType: 'aerocar',
    renderer: { type: 'canvas' }, physicsProvenance: 'legacy-aerocar',
    description: 'Элитный киберпанк-кар будущего с задними турбинными гондолами и футуристичной формой кузова.',
    primaryColor: '#a855f7', secondaryColor: '#09090b', glowColor: 'rgba(168, 85, 247, 0.55)',
    trailColor: 'rgba(168, 85, 247, 0.5)', length: 58, width: 32,
    maxSpeed: 510, acceleration: 620, braking: 740, steering: 4, grip: 0.92, durability: 0.9,
    dashPower: 520, dashCooldown: 2.8, speedBonus: 170, handlingBonus: 0.5,
  }),
  defineStaticCar({
    id: 'mazda-rx7-fd', name: 'Wazda MP-5', modelType: 'mazda-rx7-fd',
    renderer: { type: 'canvas', draw: renderMazdaRX7FD }, physicsProvenance: 'lightweight-sport-tuning',
    description: 'Экспериментальное низкое спорт-купе: плавный длинный капот, компактная кабина и большое заднее антикрыло.',
    primaryColor: '#C9152D', secondaryColor: '#171820', glowColor: 'rgba(255, 49, 95, 0.46)',
    trailColor: 'rgba(255, 49, 95, 0.46)', length: 56, width: 30,
    maxSpeed: 392, acceleration: 500, braking: 700, steering: 3.9, grip: 0.88, durability: 0.85,
    dashPower: 405, dashCooldown: 3.6, speedBonus: 52, handlingBonus: 0.3,
  }),
  defineStaticCar({
    id: 'city-cruiser-taxi-v2', name: 'City Cruiser Taxi V2', modelType: 'city-cruiser-taxi-v2',
    renderer: { type: 'canvas', draw: renderCityCruiserTaxi }, physicsProvenance: 'city-cruiser-tuning',
    description: 'Утверждённый новый кузов городского такси с собственной городской настройкой.',
    primaryColor: '#facc15', secondaryColor: '#1e293b', glowColor: 'rgba(250, 204, 21, 0.4)',
    trailColor: 'rgba(250, 204, 21, 0.4)', length: 52, width: 28,
    maxSpeed: 340, acceleration: 405, braking: 640, steering: 3.35, grip: 0.88, durability: 1,
    dashPower: 350, dashCooldown: 4, speedBonus: 0, handlingBonus: 0.08,
  }),
  defineStaticCar({
    id: 'mercedes-amg', name: 'Mercedep SLC', modelType: 'mercedes-amg',
    renderer: { type: 'canvas', draw: renderMercedesAMG }, physicsProvenance: 'power-gt-tuning',
    description: 'Мощный гран-турер с высокой тягой, устойчивостью и более тяжёлой реакцией в поворотах.',
    primaryColor: '#25282e', secondaryColor: '#ff2037', glowColor: 'rgba(255, 32, 55, 0.46)',
    trailColor: 'rgba(255, 32, 55, 0.42)', length: 52, width: 28,
    maxSpeed: 425, acceleration: 525, braking: 710, steering: 3.45, grip: 0.9, durability: 1.05,
    dashPower: 430, dashCooldown: 3.55, speedBonus: 85, handlingBonus: 0.18,
  }),
  defineStaticCar({
    id: 'lamborghini', name: 'Landorgini Suini', modelType: 'lamborghini',
    renderer: { type: 'svg', assetUrl: LAMBORGHINI_SVG_VISUAL_SPEC.assetUrl, draw: lamborghiniRenderer },
    physicsProvenance: 'reactive-hypercar-tuning',
    description: 'Утверждённый SVG-гиперкар с высокой реактивностью и менее прощающим сцеплением.',
    primaryColor: '#97ee18', secondaryColor: '#0b1016', glowColor: 'rgba(151, 238, 24, 0.5)',
    trailColor: 'rgba(151, 238, 24, 0.46)', length: 60, width: 31,
    maxSpeed: 490, acceleration: 600, braking: 680, steering: 3.95, grip: 0.8, durability: 0.78,
    dashPower: 500, dashCooldown: 3, speedBonus: 150, handlingBonus: 0.3,
  }),
]);

function readLifecycleConfig(source: unknown): CarLifecycleConfig {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('carLifecycle.json must contain an object');
  }
  const raw = source as Record<string, unknown>;
  const knownIds = new Set(STATIC_CAR_DEFINITIONS.map(entry => entry.id));
  for (const id of Object.keys(raw)) {
    if (!knownIds.has(id)) throw new Error(`Unknown carLifecycle.json id: ${id}`);
  }
  const result: Record<string, Readonly<CarLifecycleEntry>> = {};
  for (const car of STATIC_CAR_DEFINITIONS) {
    const value = raw[car.id];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Missing lifecycle config for ${car.id}`);
    }
    const lifecycle = value as Partial<CarLifecycleEntry>;
    if (lifecycle.status !== 'experimental' && lifecycle.status !== 'production') {
      throw new Error(`Invalid lifecycle status for ${car.id}`);
    }
    if (!Number.isInteger(lifecycle.price) || Number(lifecycle.price) < 0) {
      throw new Error(`Invalid lifecycle price for ${car.id}`);
    }
    if (!Number.isInteger(lifecycle.requiredOrders) || Number(lifecycle.requiredOrders) < 0) {
      throw new Error(`Invalid lifecycle requiredOrders for ${car.id}`);
    }
    result[car.id] = Object.freeze({
      status: lifecycle.status,
      price: Number(lifecycle.price),
      requiredOrders: Number(lifecycle.requiredOrders),
    });
  }
  return Object.freeze(result);
}

export const CAR_LIFECYCLE_CONFIG = readLifecycleConfig(lifecycleSource);

export function buildCarCatalog(lifecycle: CarLifecycleConfig): readonly Readonly<CarCatalogEntry>[] {
  return Object.freeze(STATIC_CAR_DEFINITIONS.map(car => {
    const state = lifecycle[car.id];
    if (!state) throw new Error(`Missing lifecycle config for ${car.id}`);
    return defineCatalogEntry({ ...car, ...state });
  }));
}

/** The runtime catalog joins static visual/physics data with the source-controlled lifecycle file. */
export const CAR_CATALOG = buildCarCatalog(CAR_LIFECYCLE_CONFIG);

function toSkin(entry: Readonly<CarCatalogEntry>): CarSkin {
  const { status: _status, renderer: _renderer, physicsProvenance: _provenance, ...skin } = entry;
  return { ...skin, modelType: skin.modelType as CarModelType };
}

export function getProductionCarSkins(catalog: readonly Readonly<CarCatalogEntry>[]): CarSkin[] {
  return catalog.filter(entry => entry.status === 'production').map(toSkin);
}

export const PRODUCTION_CAR_SKINS = getProductionCarSkins(CAR_CATALOG);
export const EXPERIMENTAL_CAR_CATALOG = CAR_CATALOG.filter(entry => entry.status === 'experimental');
export const TEST_DRIVE_CAR_SKINS = CAR_CATALOG.map(toSkin);

export function getCarCatalogEntry(id: string): Readonly<CarCatalogEntry> | undefined {
  return CAR_CATALOG.find(entry => entry.id === id);
}

export function getCatalogCarSkin(id: string): CarSkin | undefined {
  const entry = getCarCatalogEntry(id);
  return entry ? toSkin(entry) : undefined;
}

export function getProductionCarSkin(id: string): CarSkin | undefined {
  return PRODUCTION_CAR_SKINS.find(skin => skin.id === id);
}
