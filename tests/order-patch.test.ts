import assert from 'node:assert/strict';
import test from 'node:test';
import { CityMap } from '../src/game/CityMap';
import { OrdersManager } from '../src/game/OrdersManager';
import { GameEngine } from '../src/game/GameEngine';
import { CAR_SKINS } from '../src/game/Skins';
import { TestDriveSession } from '../src/game/TestDriveTrack';
import { DEFAULT_SAVE_DATA, migrateSaveData, selectNewestSave } from '../src/services/YandexAPI';
import { EXPRESS_MAX_MULTIPLIER, EXPRESS_MIN_MULTIPLIER, getExpressEfficiency,
  getNormalReward, getOrderReward, getRouteDistance, polylineDistance } from '../src/game/OrderEconomy';
import { getContractDefinition } from '../src/game/ContractSystem';

const parked = (zone: CityMap['parkingZones'][number]) => ({
  x: zone.x, y: zone.y, vx: 0, vy: 0, angle: zone.angle, length: 56, width: 30,
});

test('road route, not straight-line distance, determines normal pay; median remains calibrated', () => {
  const map = new CityMap();
  const zones = map.parkingZones;
  const pairs = Array.from({ length: 14 }, (_, index) =>
    [zones[index], zones[(index * 7 + 13) % zones.length]] as const)
    .filter(([from, to]) => from.id !== to.id);
  const samples = pairs.map(([from, to]) => {
    const routeDistance = getRouteDistance(map, { x: from.x, y: from.y, angle: from.angle }, to);
    const straight = Math.hypot(to.x - from.x, to.y - from.y);
    const oldReward = Math.round(95 + straight * 75 / 1800);
    return { routeDistance, straight, oldReward, newReward: getNormalReward(routeDistance) };
  });
  assert.ok(samples.some(sample => sample.routeDistance > sample.straight * 1.2), 'road detours were not used');
  for (const sample of samples) assert.equal(sample.newReward, getNormalReward(sample.routeDistance));
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const oldMedian = median(samples.map(sample => sample.oldReward));
  const newMedian = median(samples.map(sample => sample.newReward));
  console.log(`normal pay calibration: old median ${oldMedian}, route median ${newMedian}`);
  assert.ok(Math.abs(newMedian / oldMedian - 1) <= 0.15, 'route pricing changed median by over 15%');
  const similarRoutePairs = samples.flatMap((first, index) => samples.slice(index + 1)
    .map(second => [first, second] as const))
    .filter(([first, second]) => Math.abs(first.routeDistance - second.routeDistance) < 400 &&
      Math.abs(first.straight - second.straight) > 500);
  assert.ok(similarRoutePairs.length > 0, 'sample had no comparable route/straight-distance pair');
  for (const [first, second] of similarRoutePairs) {
    assert.ok(Math.abs(first.newReward - second.newReward) <= 11);
  }
});

test('normal is fixed; express tapers monotonically within bounds and can pay less', () => {
  const baseReward = getNormalReward(3000);
  const normal = { orderType: 'normal' as const, baseReward, targetTime: 30, rideElapsed: 0 };
  assert.equal(getOrderReward({ ...normal, rideElapsed: 900 }), baseReward);
  const express = { ...normal, orderType: 'express' as const };
  const times = [0, 30, 40, 50, 65, 75, 100];
  const efficiencies = times.map(rideElapsed => getExpressEfficiency(rideElapsed, express.targetTime));
  const rewards = times.map(rideElapsed => getOrderReward({ ...express, rideElapsed }));
  assert.ok(rewards[0] > baseReward);
  assert.ok(rewards[rewards.length - 1] < baseReward);
  for (let index = 1; index < times.length; index++) {
    assert.ok(efficiencies[index] <= efficiencies[index - 1]);
    assert.ok(rewards[index] <= rewards[index - 1]);
  }
  assert.ok(rewards.every(reward => reward >= Math.floor(baseReward * EXPRESS_MIN_MULTIPLIER) &&
    reward <= Math.ceil(baseReward * EXPRESS_MAX_MULTIPLIER)));
});

test('off shift stays empty, pickup does not run ride clock, refuse clears GPS and stops auto spawn', () => {
  const map = new CityMap();
  const orders = new OrdersManager(map);
  const emptyCar = parked(map.parkingZones[0]);
  for (let tick = 0; tick < 120; tick++) orders.update(1 / 60, emptyCar);
  assert.equal(orders.isShiftActive(), false);
  assert.equal(orders.getCurrentOrder(), null);
  const order = orders.startShift();
  assert.equal(orders.getCurrentOrder(), order);
  assert.equal(order.routeDistance, getRouteDistance(map,
    { x: order.pickupX, y: order.pickupY, angle: order.pickupAngle },
    { x: order.destinationX, y: order.destinationY }));
  const pickup = parked(map.parkingZones.find(zone => zone.id === order.pickupZoneId)!);
  for (let tick = 0; tick < 43 && order.status === 'pickup'; tick++) orders.update(1 / 60, pickup);
  assert.equal(order.status, 'in_transit');
  assert.equal(order.rideElapsed, 0);
  orders.update(2, pickup);
  assert.equal(order.rideElapsed, 2);
  map.getGpsRoute(pickup.x, pickup.y, order.destinationX, order.destinationY, pickup.angle);
  orders.refuseOrder();
  assert.equal(orders.getCurrentOrder(), null);
  assert.equal(orders.isShiftActive(), false);
  assert.equal((map as unknown as { gpsCache: unknown }).gpsCache, null);
  for (let tick = 0; tick < 120; tick++) orders.update(1 / 60, emptyCar);
  assert.equal(orders.getCurrentOrder(), null);
  assert.equal(orders.requestNextOrder(), null);
  assert.ok(orders.startShift());
});

test('delivery pays and persists once before modal; rewarded errors and duplicate callbacks are safe', async () => {
  const saved = new Map<string, string>();
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
  } as Storage;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: () => {}, devicePixelRatio: 1,
  } });
  (globalThis as typeof globalThis & { document: Document }).document = {
    addEventListener: () => {},
  } as unknown as Document;
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
  const engine = new GameEngine(canvas, migrateSaveData(DEFAULT_SAVE_DATA));
  let modalSnapshot: ReturnType<typeof migrateSaveData> | null = null;
  engine.setOnOrderCompletePrompt(() => { modalSnapshot = migrateSaveData(JSON.parse(saved.get('NEON_TAXI_SAVE_V1')!)); });
  const order = engine.startShift();
  const contractProgressBefore = new Map(
    [engine.saveData.contracts.daily, engine.saveData.contracts.weekly]
      .flatMap(state => state.items.map(item => [item.contractId, item.progress] as const)),
  );
  const pickup = parked(engine.map.parkingZones.find(zone => zone.id === order.pickupZoneId)!);
  const destination = parked(engine.map.parkingZones.find(zone => zone.id === order.destinationZoneId)!);
  for (let tick = 0; tick < 43; tick++) engine.orders.update(1 / 60, pickup);
  for (let tick = 0; tick < 43; tick++) engine.orders.update(1 / 60, destination);
  assert.equal(order.status, 'completed');
  const reward = getOrderReward(order);
  assert.equal(engine.saveData.coins, 100 + reward);
  assert.equal(engine.saveData.ordersCompleted, 1);
  assert.equal(modalSnapshot?.coins, 100 + reward);
  assert.equal(modalSnapshot?.ordersCompleted, 1);
  for (const period of ['daily', 'weekly'] as const) {
    for (const item of engine.saveData.contracts[period].items) {
      const definition = getContractDefinition(item.contractId)!;
      const expectedIncrement = definition.type === 'completeOrders' ? 1
        : definition.type === 'perfectRides' ? Number(order.perfectRide)
          : definition.type === 'vipRides' ? Number(order.passengerType === 'VIP')
            : definition.type === 'rushSuccesses' ? Number(order.rushSuccess)
              : definition.type === 'rideEarnings' ? reward
                : definition.type === 'cleanOrders' ? Number(order.strongCollisions === 0)
                  : 0;
      assert.equal(item.progress, Math.min(item.target, (contractProgressBefore.get(item.contractId) ?? 0) + expectedIncrement));
      assert.equal(
        modalSnapshot?.contracts[period].items.find(savedItem => savedItem.contractId === item.contractId)?.progress,
        item.progress,
        `${item.contractId} must be persisted before opening the order modal`,
      );
    }
  }
  assert.ok(engine.saveData.saveRevision >= 1);
  const xpAfterOrder = engine.saveData.driverXp;
  let adCallbacks: { reward?: () => void; close?: () => void; error?: (err: unknown) => void } = {};
  engine.yandexApi.registerMockAdTrigger((_type, rewardCallback, closeCallback, errorCallback) => {
    adCallbacks = { reward: rewardCallback, close: closeCallback, error: errorCallback };
  });
  await engine.yandexApi.init();
  const showAd = () => engine.yandexApi.showRewardedVideo({
    onRewarded: () => { engine.claimRewardedBonus(order.id); },
  });
  showAd();
  adCallbacks.error?.(new Error('mock network error'));
  assert.equal(engine.saveData.coins, 100 + reward);
  showAd();
  adCallbacks.close?.();
  assert.equal(engine.saveData.coins, 100 + reward);
  showAd();
  adCallbacks.reward?.();
  adCallbacks.reward?.();
  adCallbacks.close?.();
  assert.equal(engine.claimRewardedBonus(order.id), false);
  assert.equal(engine.saveData.coins, 100 + reward * 2);
  assert.equal(engine.saveData.driverXp, xpAfterOrder, 'rewarded ad must not award order XP again');
  assert.equal(migrateSaveData(JSON.parse(saved.get('NEON_TAXI_SAVE_V1')!)).coins, 100 + reward * 2);
  assert.equal(engine.orders.isShiftActive(), true);
  assert.equal(engine.orders.getCurrentOrder(), null);
  assert.ok(engine.requestNextOrder());
});

test('save conflict picks one whole newer snapshot and migrates legacy ownership', () => {
  const local = { ...DEFAULT_SAVE_DATA, saveRevision: 12, updatedAt: 100,
    coins: 5000, selectedSkinId: 'sport', unlockedSkinIds: ['cruiser', 'sport'],
    carUpgrades: { ...structuredClone(DEFAULT_SAVE_DATA.carUpgrades),
      sport: { speedLevel: 4, handlingLevel: 2, dashLevel: 3 } } };
  const cloud = { ...DEFAULT_SAVE_DATA, saveRevision: 9, updatedAt: 200, coins: 2800 };
  assert.equal(selectNewestSave(local, cloud).coins, 5000);
  assert.deepEqual(selectNewestSave(local, cloud).unlockedSkinIds, ['cruiser', 'sport']);
  assert.equal(selectNewestSave({ ...local, saveRevision: 5 }, { ...cloud, saveRevision: 8 }).coins, 2800);
  assert.equal(selectNewestSave({ ...local, saveRevision: 8 }, { ...cloud, saveRevision: 8 }).coins, 2800);
  const legacyStats = { speedLevel: 4, handlingLevel: 2, dashLevel: 3 };
  const legacy = migrateSaveData({ coins: 321, selectedSkinId: 'sport',
    unlockedSkinIds: ['cruiser', 'sport'], stats: legacyStats });
  assert.equal(legacy.saveRevision, 0);
  assert.equal(legacy.updatedAt, 0);
  assert.equal(legacy.coins, 321);
  assert.equal(legacy.selectedSkinId, 'sport');
  assert.deepEqual(legacy.carUpgrades.sport, legacyStats);
  assert.deepEqual(legacy.carUpgrades.cruiser, { speedLevel: 1, handlingLevel: 1, dashLevel: 1 });
  assert.equal('stats' in legacy, false);
  assert.ok(legacy.unlockedSkinIds.includes('sport'));
});

test('test-drive track and temporary locked car measure speed, 0–100, reset and lap without save changes', () => {
  const career = structuredClone(DEFAULT_SAVE_DATA);
  const session = new TestDriveSession(CAR_SKINS.find(skin => skin.id === 'aerocar')!);
  assert.ok(session.track.length > 9000);
  assert.equal(polylineDistance(session.track.points), session.track.length);
  assert.ok(session.track.points[0].x === 480 && session.track.points[13].x - session.track.points[0].x >= 3500);
  for (let tick = 0; tick < 360; tick++) session.update(1 / 60,
    { forward: 1, reverse: 0, steer: 0, brake: false, dash: false });
  assert.ok(session.maxSpeedKmh >= 100);
  assert.ok(session.maxSpeedKmh <= session.skin.maxSpeed / 3 + 1, 'held throttle exceeded factory maximum');
  assert.ok(session.zeroToHundred !== null && session.zeroToHundred > 0);
  const maxBeforeReset = session.maxSpeedKmh;
  session.reset();
  assert.equal(session.car.speed, 0);
  assert.equal(session.car.angularVelocity, 0);
  assert.equal(session.maxSpeedKmh, maxBeforeReset);
  for (let tick = 0; tick < 180; tick++) session.update(1 / 60,
    { forward: 1, reverse: 0, steer: 0, brake: false, dash: false });
  assert.ok(session.zeroToHundred !== null, '0–100 measurement did not restart after reset');
  session.reset();
  for (const skin of CAR_SKINS) {
    const factoryDrive = new TestDriveSession(skin);
    for (let tick = 0; tick < 360; tick++) factoryDrive.update(1 / 60,
      { forward: 1, reverse: 0, steer: 0, brake: false, dash: false });
    assert.ok(factoryDrive.maxSpeedKmh >= skin.maxSpeed / 3 - 1,
      `${skin.id} could not reach factory maximum on the long straight`);
  }
  assert.deepEqual(career, DEFAULT_SAVE_DATA);
  assert.equal(career.unlockedSkinIds.includes('aerocar'), false);
  const internals = session as unknown as { previousProgress: number; lapTravel: number };
  internals.previousProgress = session.track.length * 0.9;
  internals.lapTravel = session.track.length;
  session.car.vx = 30;
  session.car.speed = 30;
  session.update(1 / 60, { forward: 0, reverse: 0, steer: 0, brake: false, dash: false });
  assert.ok(session.bestLap !== null);
});
