import assert from 'node:assert/strict';
import test from 'node:test';
import { Car } from '../src/game/Car';
import { createSkinPurchase } from '../src/game/GameEngine';
import {
  MAZDA_RX7_FD_TEST_DRIVE_ID,
  MAZDA_RX7_FD_TEST_DRIVE_PROFILE,
  MAZDA_RX7_FD_TEST_DRIVE_SKIN,
} from '../src/game/ExperimentalCars';
import { renderMazdaRX7FD, MAZDA_RX7_FD_VISUAL_SPEC } from '../src/game/carVisuals/MazdaRX7FD';
import { CAR_SKINS } from '../src/game/Skins';
import { DEFAULT_TEST_DRIVE_LEVELS, TestDriveSession } from '../src/game/TestDriveTrack';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';

const idle = { forward: 0, reverse: 0, steer: 0, brake: false, dash: false };
const throttle = { forward: 1, reverse: 0, steer: 0, brake: false, dash: false };

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

test('Mazda Test Drive profile stays commerce-free while source lifecycle can publish its career skin', () => {
  assert.equal(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.id, MAZDA_RX7_FD_TEST_DRIVE_ID);
  assert.equal(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.name, 'Mazda RX-7 FD');
  assert.equal(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.modelType, 'mazda-rx7-fd');
  assert.equal(CAR_SKINS.some(skin => skin.id === MAZDA_RX7_FD_TEST_DRIVE_ID), true);
  assert.equal('price' in MAZDA_RX7_FD_TEST_DRIVE_PROFILE, false);
  assert.equal('requiredOrders' in MAZDA_RX7_FD_TEST_DRIVE_PROFILE, false);
  assert.deepEqual(createSkinPurchase(migrateSaveData(DEFAULT_SAVE_DATA), MAZDA_RX7_FD_TEST_DRIVE_ID), {
    status: 'notEnoughOrders', required: 1, completed: 0,
  });
});

test('published Mazda ownership and selection survive save migration', () => {
  const migrated = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    coins: 9876,
    selectedSkinId: MAZDA_RX7_FD_TEST_DRIVE_ID,
    unlockedSkinIds: ['cruiser', MAZDA_RX7_FD_TEST_DRIVE_ID],
  });
  assert.equal(migrated.coins, 9876);
  assert.equal(migrated.selectedSkinId, MAZDA_RX7_FD_TEST_DRIVE_ID);
  assert.deepEqual(migrated.unlockedSkinIds, ['cruiser', MAZDA_RX7_FD_TEST_DRIVE_ID]);
});

test('Mazda has its own lightweight tune while preserving the intended sport speed tier', () => {
  const cyberGT = CAR_SKINS.find(skin => skin.id === 'sport')!;
  assert.equal(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.maxSpeed, cyberGT.maxSpeed);
  assert.ok(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.acceleration > cyberGT.acceleration);
  assert.ok(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.steering > cyberGT.steering);
  assert.ok(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.grip > cyberGT.grip);
  assert.notEqual(MAZDA_RX7_FD_TEST_DRIVE_PROFILE.dashPower, cyberGT.dashPower);
  assert.notEqual(MAZDA_RX7_FD_TEST_DRIVE_PROFILE, cyberGT);
  assert.equal(Object.isFrozen(MAZDA_RX7_FD_TEST_DRIVE_PROFILE), true);
});

test('Mazda Test Drive starts at 1/1/1, reaches 5/5/5, and leaves career state untouched', () => {
  const career = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    coins: 4312,
    fuel: 37,
    selectedSkinId: 'skyline-r34',
    unlockedSkinIds: ['cruiser', 'skyline-r34'],
    carUpgrades: { ...structuredClone(DEFAULT_SAVE_DATA.carUpgrades),
      'skyline-r34': { speedLevel: 2, handlingLevel: 3, dashLevel: 4 } },
  });
  const before = JSON.stringify(career);
  const session = new TestDriveSession(MAZDA_RX7_FD_TEST_DRIVE_SKIN);
  assert.deepEqual(session.levels, DEFAULT_TEST_DRIVE_LEVELS);
  assert.equal(session.setUpgradeLevel('speed', 5), true);
  assert.equal(session.setUpgradeLevel('handling', 5), true);
  assert.equal(session.setUpgradeLevel('dash', 5), true);
  assert.deepEqual(session.levels, { speedLevel: 5, handlingLevel: 5, dashLevel: 5 });
  assert.equal(JSON.stringify(career), before);
});

test('Mazda Test Drive telemetry and Dash afterimages remain active', () => {
  const session = new TestDriveSession(MAZDA_RX7_FD_TEST_DRIVE_SKIN);
  for (let tick = 0; tick < 120; tick++) session.update(1 / 60, throttle);
  assert.ok(session.elapsed > 1.9);
  assert.ok(session.lapElapsed > 1.9);
  assert.ok(session.maxSpeedKmh > 0);

  session.reset();
  session.car.vx = session.car.maxSpeed;
  session.car.speed = session.car.maxSpeed;
  assert.equal(session.car.triggerDash(), true);
  session.update(1 / 60, throttle);
  assert.ok((session.car as unknown as { ghostTrails: unknown[] }).ghostTrails.length > 0);
  session.update(1 / 60, idle);
});

test('Mazda blueprint keeps a centered pivot and front at positive X', () => {
  assert.equal(MAZDA_RX7_FD_VISUAL_SPEC.front, '+X');
  assert.deepEqual(MAZDA_RX7_FD_VISUAL_SPEC.pivot, { x: 0, y: 0 });
  assert.equal(MAZDA_RX7_FD_VISUAL_SPEC.normalizedBounds.xMin, -MAZDA_RX7_FD_VISUAL_SPEC.normalizedBounds.xMax);
  assert.equal(MAZDA_RX7_FD_VISUAL_SPEC.normalizedBounds.yMin, -MAZDA_RX7_FD_VISUAL_SPEC.normalizedBounds.yMax);
  assert.ok(MAZDA_RX7_FD_VISUAL_SPEC.frontAxleX > 0);
  assert.ok(MAZDA_RX7_FD_VISUAL_SPEC.rearWingX < MAZDA_RX7_FD_VISUAL_SPEC.rearAxleX);
});

test('custom renderer registry dispatches Mazda while preserving Skyline custom dispatch', () => {
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
  Car.registerVisualRenderer('mazda-rx7-fd', () => calls.push('mazda-custom'));
  try {
    Car.drawCarDetailed(mockCanvasContext(), MAZDA_RX7_FD_TEST_DRIVE_SKIN);
    assert.deepEqual(calls, ['mazda-custom']);
    calls.length = 0;
    Car.drawCarDetailed(mockCanvasContext(), CAR_SKINS.find(skin => skin.id === 'skyline-r34')!);
    assert.deepEqual(calls, [], 'Skyline unexpectedly fell back to a legacy renderer');
  } finally {
    Object.assign(Car, legacy);
    Car.registerVisualRenderer('mazda-rx7-fd', renderMazdaRX7FD);
  }
});
