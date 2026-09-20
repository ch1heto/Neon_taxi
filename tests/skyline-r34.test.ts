import assert from 'node:assert/strict';
import test from 'node:test';
import { Car } from '../src/game/Car';
import { renderNeonStreetGT as renderSkylineR34 } from '../src/game/carVisuals/NeonStreetGT';
import { createSkinPurchase } from '../src/game/GameEngine';
import { CAR_SKINS } from '../src/game/Skins';
import { DEFAULT_TEST_DRIVE_LEVELS, TestDriveSession } from '../src/game/TestDriveTrack';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';

const SKYLINE_ID = 'skyline-r34';
const skyline = CAR_SKINS.find(skin => skin.id === SKYLINE_ID)!;

function mockCanvasContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(target, property) {
      if (property in target) return target[property as keyof CanvasRenderingContext2D];
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient;
      return () => undefined;
    },
    set(target, property, value) {
      Object.defineProperty(target, property, { value, writable: true, configurable: true });
      return true;
    },
  });
}

test('Skyline remains a career skin whose commerce metadata comes from the catalog', () => {
  assert.ok(CAR_SKINS.length >= 6);
  assert.ok(skyline);
  assert.equal(skyline.name, 'Nissan Skyline GT-R R34');
  assert.equal(skyline.modelType, 'skyline-r34');
  assert.ok(Number.isInteger(skyline.price) && skyline.price >= 0);
  assert.ok(Number.isInteger(skyline.requiredOrders) && skyline.requiredOrders >= 0);
  assert.equal(CAR_SKINS.some(skin => skin.id === 'experimental-neon-street-gt'), false);
});

test('Skyline purchase enforces money and orders, unlocks once, and selects the car', () => {
  const eligible = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    coins: skyline.price,
    ordersCompleted: skyline.requiredOrders,
    selectedSkinId: 'cruiser',
    unlockedSkinIds: ['cruiser'],
  });
  if (skyline.requiredOrders > 0) {
    assert.deepEqual(createSkinPurchase({ ...eligible, ordersCompleted: skyline.requiredOrders - 1 }, SKYLINE_ID), {
      status: 'notEnoughOrders', required: skyline.requiredOrders, completed: skyline.requiredOrders - 1,
    });
  }
  if (skyline.price > 0) {
    assert.deepEqual(createSkinPurchase({ ...eligible, coins: skyline.price - 1 }, SKYLINE_ID), {
      status: 'notEnoughCoins', missingCoins: 1,
    });
  }

  const purchase = createSkinPurchase(eligible, SKYLINE_ID);
  assert.equal(purchase.status, 'success');
  if (purchase.status !== 'success') return;
  assert.equal(purchase.saveData.coins, 0);
  assert.equal(purchase.saveData.selectedSkinId, SKYLINE_ID);
  assert.equal(purchase.saveData.unlockedSkinIds.filter(id => id === SKYLINE_ID).length, 1);

  const selectedAgain = createSkinPurchase(purchase.saveData, SKYLINE_ID);
  assert.equal(selectedAgain.status, 'alreadyOwned');
  if (selectedAgain.status !== 'alreadyOwned') return;
  assert.equal(selectedAgain.saveData.coins, 0);
  assert.equal(selectedAgain.saveData.unlockedSkinIds.filter(id => id === SKYLINE_ID).length, 1);
});

test('save migration assigns legacy global tuning only to the selected Skyline', () => {
  const saved = JSON.parse(JSON.stringify({
    saveRevision: 9,
    coins: 321,
    fuel: 41.5,
    selectedSkinId: SKYLINE_ID,
    unlockedSkinIds: ['cruiser', SKYLINE_ID],
    stats: { speedLevel: 3, handlingLevel: 2, dashLevel: 4 },
  }));
  const loaded = migrateSaveData(saved);
  assert.equal(loaded.selectedSkinId, SKYLINE_ID);
  assert.deepEqual(loaded.unlockedSkinIds, ['cruiser', SKYLINE_ID]);
  assert.equal(loaded.saveRevision, 9);
  assert.equal(loaded.coins, 321);
  assert.equal(loaded.fuel, 41.5);
  assert.deepEqual(loaded.carUpgrades[SKYLINE_ID], { speedLevel: 3, handlingLevel: 2, dashLevel: 4 });
  assert.deepEqual(loaded.carUpgrades.cruiser, { speedLevel: 1, handlingLevel: 1, dashLevel: 1 });
  assert.equal('stats' in loaded, false);
});

test('Skyline Test Drive starts at 1/1/1 and supports all temporary upgrade levels', () => {
  const session = new TestDriveSession(skyline);
  assert.deepEqual(session.levels, DEFAULT_TEST_DRIVE_LEVELS);
  const baseline = {
    maxSpeed: session.car.maxSpeed,
    turnSpeed: session.car.turnSpeed,
    dashPower: session.car.dashSpeedBoost,
  };
  session.setUpgradeLevel('speed', 5);
  session.setUpgradeLevel('handling', 5);
  session.setUpgradeLevel('dash', 5);
  assert.deepEqual(session.levels, { speedLevel: 5, handlingLevel: 5, dashLevel: 5 });
  assert.ok(session.car.maxSpeed > baseline.maxSpeed);
  assert.ok(session.car.turnSpeed > baseline.turnSpeed);
  assert.ok(session.car.dashSpeedBoost > baseline.dashPower);
});

test('Skyline keeps the approved dimensions but owns a distinct high-performance tune', () => {
  const cruiser = CAR_SKINS.find(skin => skin.id === 'cruiser')!;
  assert.equal(skyline.length, cruiser.length);
  assert.equal(skyline.width, cruiser.width);
  assert.equal(skyline.maxSpeed, 455);
  assert.ok(skyline.acceleration > cruiser.acceleration);
  assert.ok(skyline.steering > cruiser.steering);
  assert.ok(skyline.dashPower > cruiser.dashPower);
  assert.notEqual(skyline, cruiser);
});

test('custom registry dispatches Skyline renderer before every legacy fallback', () => {
  const legacy = {
    renderCityCruiser: Car.renderCityCruiser,
    renderSportCoupe: Car.renderSportCoupe,
    renderTitanSUV: Car.renderTitanSUV,
    renderHypercar: Car.renderHypercar,
    renderAerocar: Car.renderAerocar,
  };
  const calls: string[] = [];
  for (const name of Object.keys(legacy) as (keyof typeof legacy)[]) {
    Car[name] = (() => calls.push(name)) as typeof Car[typeof name];
  }
  Car.registerVisualRenderer('skyline-r34', () => calls.push('custom'));
  try {
    Car.drawCarDetailed(mockCanvasContext(), skyline);
    assert.deepEqual(calls, ['custom']);
    assert.equal('registerNeonStreetGTRenderer' in Car, false);
  } finally {
    Object.assign(Car, legacy);
    Car.registerVisualRenderer('skyline-r34', renderSkylineR34);
  }
});

test('all five legacy models still fall back to their existing body renderers', () => {
  const methodByModel = {
    sedan: 'renderCityCruiser',
    sport: 'renderSportCoupe',
    suv: 'renderTitanSUV',
    hyper: 'renderHypercar',
    aerocar: 'renderAerocar',
  } as const;
  const originals = {
    renderCityCruiser: Car.renderCityCruiser,
    renderSportCoupe: Car.renderSportCoupe,
    renderTitanSUV: Car.renderTitanSUV,
    renderHypercar: Car.renderHypercar,
    renderAerocar: Car.renderAerocar,
  };
  const calls: string[] = [];
  for (const name of Object.values(methodByModel)) {
    Car[name] = (() => calls.push(name)) as typeof Car[typeof name];
  }
  try {
    for (const skin of CAR_SKINS.filter(candidate => candidate.id !== SKYLINE_ID)) {
      Car.drawCarDetailed(mockCanvasContext(), skin);
    }
    assert.deepEqual(calls, Object.values(methodByModel));
  } finally {
    Object.assign(Car, originals);
  }
});
