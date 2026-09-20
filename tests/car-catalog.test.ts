import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { carLifecycleDevPlugin, validateCarLifecycleUpdate } from '../dev/carLifecycleVitePlugin';
import { Car, calculateMaxSpeedForLevel } from '../src/game/Car';
import {
  CAR_CATALOG,
  CAR_LIFECYCLE_CONFIG,
  EXPERIMENTAL_CAR_CATALOG,
  PRODUCTION_CAR_SKINS,
  TEST_DRIVE_CAR_SKINS,
  buildCarCatalog,
  getCatalogCarSkin,
  getProductionCarSkins,
  type CarLifecycleConfig,
  type CarLifecycleEntry,
} from '../src/game/CarCatalog';
import { createSkinPurchase, speedToKmh as engineSpeedToKmh } from '../src/game/GameEngine';
import { CAR_SKINS } from '../src/game/Skins';
import { CITY_CRUISER_TAXI_VISUAL_SPEC } from '../src/game/carVisuals/CityCruiserTaxi';
import { MERCEDES_AMG_VISUAL_SPEC, renderMercedesAMG } from '../src/game/carVisuals/MercedesAMG';
import {
  LAMBORGHINI_SVG_VISUAL_SPEC,
  clearSvgImageCacheForTests,
  createSvgCarRenderer,
  getSvgImageCacheSize,
} from '../src/game/carVisuals/SvgCarRenderer';
import { TestDriveSession } from '../src/game/TestDriveTrack';
import { speedToKmh } from '../src/game/VehicleMetrics';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';

const experimentalIds = Object.entries(CAR_LIFECYCLE_CONFIG)
  .filter(([, lifecycle]) => lifecycle.status === 'experimental')
  .map(([id]) => id);
const speedOrder = ['cruiser', 'mazda-rx7-fd', 'mercedes-amg', 'skyline-r34', 'lamborghini', 'aerocar'] as const;
const throttle = { forward: 1, reverse: 0, steer: 0, brake: false, dash: false };

function lifecycleWith(id: string, entry: CarLifecycleEntry): CarLifecycleConfig {
  return Object.freeze({ ...CAR_LIFECYCLE_CONFIG, [id]: Object.freeze({ ...entry }) });
}

function mockCanvasContext(onDrawImage?: (...args: unknown[]) => void): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(target, property) {
      if (property in target) return target[property as keyof CanvasRenderingContext2D];
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient;
      if (property === 'drawImage') return (...args: unknown[]) => onDrawImage?.(...args);
      return () => undefined;
    },
    set(target, property, value) {
      Object.defineProperty(target, property, { value, writable: true, configurable: true });
      return true;
    },
  });
}

test('stable experimental ids are catalog-driven Test Drive choices and stay outside career skins', () => {
  for (const id of experimentalIds) {
    assert.equal(CAR_LIFECYCLE_CONFIG[id].status, 'experimental');
    assert.ok(TEST_DRIVE_CAR_SKINS.some(skin => skin.id === id));
    assert.equal(CAR_SKINS.some(skin => skin.id === id), false);
  }
  assert.equal(CAR_CATALOG.some(entry => entry.id === 'experimental-mazda-rx7-fd'), false);
  assert.deepEqual(EXPERIMENTAL_CAR_CATALOG.map(entry => entry.id), [...experimentalIds]);
});

test('lifecycle JSON is the only source for status, price, and required orders', () => {
  for (const entry of CAR_CATALOG) {
    assert.deepEqual(
      { status: entry.status, price: entry.price, requiredOrders: entry.requiredOrders },
      CAR_LIFECYCLE_CONFIG[entry.id],
    );
  }
  assert.deepEqual(
    CAR_CATALOG.map(entry => entry.id),
    Object.keys(CAR_LIFECYCLE_CONFIG),
  );
});

test('Mercedes palette restores graphite body and bright red approved renderer graphics', () => {
  const mercedes = CAR_CATALOG.find(entry => entry.id === 'mercedes-amg')!;
  assert.equal(mercedes.primaryColor, '#25282e');
  assert.equal(mercedes.secondaryColor, '#ff2037');
  assert.equal(mercedes.renderer.draw, renderMercedesAMG);
  assert.equal(MERCEDES_AMG_VISUAL_SPEC.front, '+X');
});

test('base max speed follows City < Mazda < Mercedes < Skyline < Lamborghini < Phantom', () => {
  const speeds = speedOrder.map(id => getCatalogCarSkin(id)!.maxSpeed);
  assert.deepEqual(speeds, [340, 392, 425, 455, 490, 510]);
  for (let index = 1; index < speeds.length; index++) assert.ok(speeds[index - 1] < speeds[index]);
});

test('Test Drive level 1 and level 5 preserve the model speed ladder', () => {
  for (const level of [1, 5]) {
    const speeds = speedOrder.map(id => {
      const session = new TestDriveSession(getCatalogCarSkin(id)!);
      session.setUpgradeLevel('speed', level);
      return session.car.maxSpeed;
    });
    for (let index = 1; index < speeds.length; index++) assert.ok(speeds[index - 1] < speeds[index], `level ${level}`);
  }
});

test('Car.applyUpgrades derives runtime speed and acceleration from each selected model', () => {
  for (const id of speedOrder) {
    const skin = getCatalogCarSkin(id)!;
    const car = new Car(0, 0);
    car.applyUpgrades({ speedLevel: 5, handlingLevel: 1, dashLevel: 1 }, skin);
    assert.equal(car.maxSpeed, calculateMaxSpeedForLevel(skin.maxSpeed, 5));
    assert.equal(car.acceleration, skin.acceleration * 1.2);
  }
});

test('Mercedes, Skyline, Lamborghini, and legacy Hyper have distinct real handling profiles', () => {
  const mercedes = getCatalogCarSkin('mercedes-amg')!;
  const skyline = getCatalogCarSkin('skyline-r34')!;
  const lamborghini = getCatalogCarSkin('lamborghini')!;
  const hyper = getCatalogCarSkin('hyper')!;
  assert.notEqual(mercedes.acceleration, skyline.acceleration);
  assert.notEqual(mercedes.steering, skyline.steering);
  assert.notEqual(lamborghini.maxSpeed, hyper.maxSpeed);
  assert.notEqual(lamborghini.grip, hyper.grip);
});

test('Garage, engine, and Test Drive use the shared speed conversion and upgrade formula', () => {
  assert.equal(engineSpeedToKmh, speedToKmh);
  const shopSource = readFileSync(new URL('../src/components/ShopModal.tsx', import.meta.url), 'utf8');
  assert.match(shopSource, /speedToKmh\(currentPreviewSkin\.maxSpeed\)/);
  assert.match(shopSource, /calculateMaxSpeedForLevel\(currentPreviewSkin\.maxSpeed, 5\)/);
  assert.doesNotMatch(shopSource, /speedBonus[^\n]*км\/ч/);
});

test('experimental purchase is invalid; source promotion enables the normal purchase flow', () => {
  const id = experimentalIds[0];
  assert.ok(id, 'source lifecycle needs an experimental car for promotion coverage');
  assert.deepEqual(createSkinPurchase(migrateSaveData(DEFAULT_SAVE_DATA), id), { status: 'invalidSkin' });

  const promotedCatalog = buildCarCatalog(lifecycleWith(id, {
    status: 'production', price: 7000, requiredOrders: 30,
  }));
  const promotedSkins = getProductionCarSkins(promotedCatalog);
  const baseSave = migrateSaveData({ ...DEFAULT_SAVE_DATA, coins: 7000, ordersCompleted: 30 });
  assert.deepEqual(createSkinPurchase({ ...baseSave, ordersCompleted: 29 }, id, promotedSkins), {
    status: 'notEnoughOrders', required: 30, completed: 29,
  });
  assert.deepEqual(createSkinPurchase({ ...baseSave, coins: 6999 }, id, promotedSkins), {
    status: 'notEnoughCoins', missingCoins: 1,
  });
  const purchase = createSkinPurchase(baseSave, id, promotedSkins);
  assert.equal(purchase.status, 'success');
  if (purchase.status !== 'success') return;
  assert.equal(purchase.saveData.coins, 0);
  assert.equal(purchase.saveData.selectedSkinId, id);
  assert.ok(purchase.saveData.unlockedSkinIds.includes(id));
});

test('demoting a previously selected production car safely falls back to Cruiser', () => {
  const demotedCatalog = buildCarCatalog(lifecycleWith('skyline-r34', {
    ...CAR_LIFECYCLE_CONFIG['skyline-r34'], status: 'experimental',
  }));
  const migrated = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    selectedSkinId: 'skyline-r34',
    unlockedSkinIds: ['cruiser', 'skyline-r34'],
  }, getProductionCarSkins(demotedCatalog));
  assert.equal(migrated.selectedSkinId, 'cruiser');
  assert.deepEqual(migrated.unlockedSkinIds, ['cruiser']);
});

test('DEV lifecycle endpoint validates ids, enums, integers, and rejects arbitrary fields', () => {
  const knownIds = new Set(CAR_CATALOG.map(entry => entry.id));
  assert.equal(validateCarLifecycleUpdate({
    id: 'mercedes-amg', status: 'production', price: 7000, requiredOrders: 30,
  }, knownIds).ok, true);
  assert.equal(validateCarLifecycleUpdate({
    id: 'unknown', status: 'production', price: 0, requiredOrders: 0,
  }, knownIds).ok, false);
  assert.equal(validateCarLifecycleUpdate({
    id: 'mercedes-amg', status: 'production', price: 1.5, requiredOrders: 0,
  }, knownIds).ok, false);
  assert.equal(validateCarLifecycleUpdate({
    id: 'mercedes-amg', status: 'production', price: 7000, requiredOrders: 30, filepath: '../x',
  }, knownIds).ok, false);
  assert.equal(carLifecycleDevPlugin('fixed.json').apply, 'serve');
});

test('DEV source controls are hard-guarded and preview disables the rotating body shadow', () => {
  const shopSource = readFileSync(new URL('../src/components/ShopModal.tsx', import.meta.url), 'utf8');
  const previewSource = readFileSync(new URL('../src/components/CarPreviewCanvas.tsx', import.meta.url), 'utf8');
  assert.match(shopSource, /import\.meta\.env\.DEV && \(/);
  assert.match(shopSource, /ОПУБЛИКОВАТЬ В МАГАЗИН/);
  assert.match(previewSource, /drawCarDetailed\(ctx, skin, 2\.3, angleRef\.current, false\)/);
});

test('Test Drive tuning leaves career coins, ownership, selection, fuel, and upgrades untouched', () => {
  for (const id of experimentalIds) {
    const career = structuredClone({
      ...DEFAULT_SAVE_DATA,
      coins: 8123,
      fuel: 43,
      selectedSkinId: 'skyline-r34',
      unlockedSkinIds: ['cruiser', 'skyline-r34'],
      carUpgrades: { ...structuredClone(DEFAULT_SAVE_DATA.carUpgrades),
        'skyline-r34': { speedLevel: 2, handlingLevel: 4, dashLevel: 3 } },
    });
    const before = structuredClone(career);
    const session = new TestDriveSession(getCatalogCarSkin(id)!);
    session.setUpgradeLevel('speed', 5);
    session.setUpgradeLevel('handling', 5);
    session.setUpgradeLevel('dash', 5);
    for (let tick = 0; tick < 30; tick++) session.update(1 / 60, throttle);
    assert.deepEqual(career, before, id);
  }
});

test('SVG renderer caches one Image, centers the asset, and falls back while loading', () => {
  const originalImage = globalThis.Image;
  class FakeImage {
    static constructions = 0;
    static last: FakeImage | null = null;
    decoding = '';
    complete = false;
    naturalWidth = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    constructor() { FakeImage.constructions++; FakeImage.last = this; }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
  clearSvgImageCacheForTests();
  try {
    const calls: unknown[][] = [];
    const ctx = mockCanvasContext((...args) => calls.push(args));
    const skin = getCatalogCarSkin('lamborghini')!;
    const renderer = createSvgCarRenderer(LAMBORGHINI_SVG_VISUAL_SPEC.assetUrl);
    renderer(ctx, skin.length, skin.width, skin);
    renderer(ctx, skin.length, skin.width, skin);
    assert.equal(FakeImage.constructions, 1);
    assert.equal(getSvgImageCacheSize(), 1);
    assert.equal(calls.length, 0);
    FakeImage.last!.complete = true;
    FakeImage.last!.naturalWidth = 1411;
    FakeImage.last!.onload?.();
    renderer(ctx, skin.length, skin.width, skin);
    assert.deepEqual(calls[0]?.slice(1), [-skin.length / 2, -skin.width / 2, skin.length, skin.width]);
  } finally {
    globalThis.Image = originalImage;
    clearSvgImageCacheForTests();
  }
});

test('approved Canvas renderers and Lamborghini SVG remain byte-identical to supplied assets', () => {
  const sha256 = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex').toUpperCase();
  assert.equal(sha256(new URL('../src/game/carVisuals/CityCruiserTaxi.ts', import.meta.url)),
    'B1D8BCB9AF0293FA12E1960940D659A5C449E5BB591DFBDBC49222C024E7C116');
  assert.equal(sha256(new URL('../src/game/carVisuals/MercedesAMG.ts', import.meta.url)),
    'D32935BA180B68D06CDB2C82E1095675B09065CFB7F3816EEE9A3CC54508ED3A');
  assert.equal(sha256(new URL('../public/assets/cars/lamborghini.svg', import.meta.url)),
    '8C470D086976C71F361A74282759FB90E532BDD30E2292ECC68A73AA4E22C69F');
  assert.equal(CITY_CRUISER_TAXI_VISUAL_SPEC.front, '+X');
});
