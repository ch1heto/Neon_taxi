import assert from 'node:assert/strict';
import test from 'node:test';
import { CityMap } from '../src/game/CityMap';
import { OrdersManager } from '../src/game/OrdersManager';
import {
  getCautiousAggressionSeverity,
  getCollisionQualityPenalty,
  LONG_DISTANCE_MIN_ROUTE_DISTANCE,
  PASSENGER_DEFINITIONS,
  selectPassengerType,
} from '../src/game/PassengerSystem';
import {
  getExpressEfficiency,
  getExpressTargetTime,
  getEstimatedOrderReward,
  getNormalReward,
  getOrderReward,
  getRushEarlyMoneyBonus,
  getRushEarlyRatio,
  RUSH_MAX_EARLY_MONEY_BONUS,
} from '../src/game/OrderEconomy';
import {
  calculateOrderXp,
  getXpProgress,
  levelFromXp,
  MAX_DRIVER_LEVEL,
  xpForLevel,
} from '../src/game/DriverProgression';
import {
  calculateShiftScore,
  completeShift,
  createShiftStats,
  scoreToRating,
} from '../src/game/ShiftSystem';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';
import { createUpgradePurchase, GameEngine } from '../src/game/GameEngine';
import { getCarUpgradeStats } from '../src/game/CarUpgrades';

function installEngineGlobals() {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  } });
  (globalThis as typeof globalThis & { document: Document }).document = {
    addEventListener: () => {}, removeEventListener: () => {},
  } as unknown as Document;
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
    getItem: () => null,
    setItem: () => {},
  } as unknown as Storage;
}

function createEngine(save = DEFAULT_SAVE_DATA): GameEngine {
  installEngineGlobals();
  return new GameEngine({ getContext: () => ({}) } as unknown as HTMLCanvasElement, migrateSaveData(save));
}

test('passenger distribution is complete, valid and normalized', () => {
  const definitions = Object.values(PASSENGER_DEFINITIONS);
  assert.ok(Math.abs(definitions.reduce((sum, definition) => sum + definition.probability, 0) - 1) < 1e-12);
  assert.ok(PASSENGER_DEFINITIONS.NORMAL.probability >= 0.45);
  assert.ok(PASSENGER_DEFINITIONS.VIP.probability <= 0.12);
  for (let sample = 0; sample < 1_000; sample++) {
    assert.ok(selectPassengerType(sample / 1_000) in PASSENGER_DEFINITIONS);
  }
  for (const definition of definitions) {
    assert.ok(definition.rewardModifier > 0);
    assert.ok(definition.xpModifier > 0);
    assert.ok(definition.dialogue.length >= 2);
  }
});

test('VIP quality, Rush time and Cautious collision rules affect one shared order model', () => {
  const base = getNormalReward(3_000);
  const vipComfort = getOrderReward({
    orderType: 'normal', baseReward: base, targetTime: 30, rideElapsed: 20,
    passengerType: 'VIP', rideQuality: 100,
  });
  const vipDamaged = getOrderReward({
    orderType: 'normal', baseReward: base, targetTime: 30, rideElapsed: 20,
    passengerType: 'VIP', rideQuality: 40,
  });
  assert.ok(vipComfort > vipDamaged);
  assert.equal(PASSENGER_DEFINITIONS.RUSH.targetTimeModifier, 0.8);
  assert.ok(getExpressTargetTime(3_000) * PASSENGER_DEFINITIONS.RUSH.targetTimeModifier < getExpressTargetTime(3_000));
  assert.equal(getCollisionQualityPenalty('CAUTIOUS', 0.2), 0);
  assert.ok(getCollisionQualityPenalty('CAUTIOUS', 0.8) > getCollisionQualityPenalty('VIP', 0.8));
  assert.ok(Number.isFinite(getOrderReward({
    orderType: 'express', baseReward: Number.NaN, targetTime: Number.NaN, rideElapsed: Number.NaN,
    passengerType: 'NORMAL', rideQuality: Number.NaN,
  })));
});

test('Long Distance selects a reachable route over the configured threshold', () => {
  const map = new CityMap();
  const orders = new OrdersManager(map);
  const internals = orders as unknown as {
    selectDestination: (pickup: CityMap['parkingZones'][number], type: 'LONG_DISTANCE') => {
      zone: CityMap['parkingZones'][number]; routeDistance: number;
    };
  };
  for (const pickup of map.parkingZones.slice(0, 8)) {
    const selection = internals.selectDestination(pickup, 'LONG_DISTANCE');
    assert.notEqual(selection.zone.id, pickup.id);
    assert.ok(selection.routeDistance >= LONG_DISTANCE_MIN_ROUTE_DISTANCE,
      `${pickup.id} only produced ${selection.routeDistance}`);
  }
});

test('XP curve is monotonic, bounded and rewards passenger/perfect modifiers', () => {
  for (let level = 2; level <= MAX_DRIVER_LEVEL; level++) {
    assert.ok(xpForLevel(level) > xpForLevel(level - 1));
    assert.equal(levelFromXp(xpForLevel(level)), level);
  }
  assert.equal(levelFromXp(-100), 1);
  assert.equal(levelFromXp(Number.NaN), 1);
  assert.equal(levelFromXp(Number.MAX_SAFE_INTEGER), MAX_DRIVER_LEVEL);
  const normal = calculateOrderXp({
    routeDistance: 3_000, passengerType: 'NORMAL', rideQuality: 80,
    strongCollisions: 1, rushSuccess: false,
  });
  const perfectVip = calculateOrderXp({
    routeDistance: 3_000, passengerType: 'VIP', rideQuality: 100,
    strongCollisions: 0, rushSuccess: false,
  });
  assert.ok(normal >= 0);
  assert.ok(perfectVip > normal);
});

test('level progress distinguishes lifetime XP across exact and multi-level crossings', () => {
  const before = getXpProgress(148);
  const after = getXpProgress(148 + 209);
  assert.deepEqual({ level: before.level, current: before.current, total: before.total },
    { level: 2, current: 3, total: 148 });
  assert.deepEqual({ level: after.level, current: after.current, required: after.required, total: after.total },
    { level: 3, current: 16, required: 235, total: 357 });
  const multiLevel = getXpProgress(148 + 2_000);
  assert.ok(multiLevel.level > before.level + 1);
  assert.equal(multiLevel.total, 2_148);
});

test('per-car tuning migrates, clamps, preserves experimental IDs and upgrades only its target car', () => {
  const legacy = migrateSaveData({
    selectedSkinId: 'skyline-r34',
    unlockedSkinIds: ['cruiser', 'skyline-r34'],
    stats: { speedLevel: 4, handlingLevel: 3, dashLevel: 2 },
  });
  assert.deepEqual(getCarUpgradeStats(legacy, 'skyline-r34'),
    { speedLevel: 4, handlingLevel: 3, dashLevel: 2 });
  assert.deepEqual(getCarUpgradeStats(legacy, 'lamborghini'),
    { speedLevel: 1, handlingLevel: 1, dashLevel: 1 });

  const corrupted = migrateSaveData({
    ...legacy,
    carUpgrades: {
      'skyline-r34': { speedLevel: 99, handlingLevel: Number.NaN, dashLevel: -4 },
      'city-cruiser-taxi-v2': { speedLevel: 2, handlingLevel: 3, dashLevel: 4 },
      ghost: { speedLevel: 5, handlingLevel: 5, dashLevel: 5 },
    },
  });
  assert.deepEqual(corrupted.carUpgrades['skyline-r34'],
    { speedLevel: 5, handlingLevel: 1, dashLevel: 1 });
  assert.deepEqual(corrupted.carUpgrades['city-cruiser-taxi-v2'],
    { speedLevel: 2, handlingLevel: 3, dashLevel: 4 });
  assert.equal(corrupted.carUpgrades.ghost, undefined);

  const purchaseBase = migrateSaveData({
    ...legacy,
    coins: 5_000,
    carUpgrades: {
      ...legacy.carUpgrades,
      'skyline-r34': { speedLevel: 4, handlingLevel: 3, dashLevel: 2 },
      lamborghini: { speedLevel: 1, handlingLevel: 1, dashLevel: 1 },
    },
  });
  const upgraded = createUpgradePurchase(purchaseBase, 'speed', 'skyline-r34')!;
  assert.equal(upgraded.coins, 3_500);
  assert.equal(upgraded.carUpgrades['skyline-r34'].speedLevel, 5);
  assert.equal(upgraded.carUpgrades.lamborghini.speedLevel, 1);
  assert.equal(purchaseBase.carUpgrades['skyline-r34'].speedLevel, 4);

  const runtime = Object.create(GameEngine.prototype) as GameEngine & {
    applied?: { levels: { speedLevel: number }; skinId: string };
  };
  runtime.car = {
    applyUpgrades: (levels: { speedLevel: number }, skin: { id: string }) => {
      runtime.applied = { levels, skinId: skin.id };
    },
    setRuntimePerformanceMultiplier: () => {},
  } as never;
  runtime.syncSaveData({ ...upgraded, selectedSkinId: 'lamborghini' });
  assert.deepEqual(runtime.applied, { levels: upgraded.carUpgrades.lamborghini, skinId: 'lamborghini' });
  runtime.syncSaveData({ ...upgraded, selectedSkinId: 'skyline-r34' });
  assert.deepEqual(runtime.applied, { levels: upgraded.carUpgrades['skyline-r34'], skinId: 'skyline-r34' });
});

test('migration fills a missing selected-car entry from legacy stats without losing another car', () => {
  const migrated = migrateSaveData({
    selectedSkinId: 'skyline-r34',
    unlockedSkinIds: ['cruiser', 'skyline-r34', 'mazda-rx7-fd'],
    stats: { speedLevel: 4, handlingLevel: 3, dashLevel: 2 },
    carUpgrades: {
      'mazda-rx7-fd': { speedLevel: 2, handlingLevel: 1, dashLevel: 1 },
    },
  });
  assert.deepEqual(migrated.carUpgrades['skyline-r34'],
    { speedLevel: 4, handlingLevel: 3, dashLevel: 2 });
  assert.deepEqual(migrated.carUpgrades['mazda-rx7-fd'],
    { speedLevel: 2, handlingLevel: 1, dashLevel: 1 });
});

test('migration never overwrites a valid selected-car entry with legacy stats', () => {
  const migrated = migrateSaveData({
    selectedSkinId: 'skyline-r34',
    unlockedSkinIds: ['cruiser', 'skyline-r34'],
    stats: { speedLevel: 2, handlingLevel: 2, dashLevel: 2 },
    carUpgrades: {
      'skyline-r34': { speedLevel: 5, handlingLevel: 4, dashLevel: 3 },
    },
  });
  assert.deepEqual(migrated.carUpgrades['skyline-r34'],
    { speedLevel: 5, handlingLevel: 4, dashLevel: 3 });
});

test('career upgrade purchase accepts only owned production cars and a valid type', () => {
  const owned = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    coins: 5_000,
    selectedSkinId: 'skyline-r34',
    unlockedSkinIds: ['cruiser', 'skyline-r34'],
    carUpgrades: {
      ...DEFAULT_SAVE_DATA.carUpgrades,
      'skyline-r34': { speedLevel: 2, handlingLevel: 3, dashLevel: 4 },
      lamborghini: { speedLevel: 4, handlingLevel: 2, dashLevel: 1 },
    },
  });
  const purchased = createUpgradePurchase(owned, 'speed', 'skyline-r34');
  assert.ok(purchased);
  assert.equal(purchased.carUpgrades['skyline-r34'].speedLevel, 3);
  assert.deepEqual(purchased.carUpgrades.lamborghini, owned.carUpgrades.lamborghini);
  assert.equal(owned.carUpgrades['skyline-r34'].speedLevel, 2);

  const notOwned = { ...owned, unlockedSkinIds: ['cruiser'] };
  assert.equal(createUpgradePurchase(notOwned, 'speed', 'skyline-r34'), null);
  assert.equal(createUpgradePurchase(owned, 'speed', 'city-cruiser-taxi-v2'), null);
  assert.equal(createUpgradePurchase(owned, 'speed', 'unknown-car'), null);
  assert.equal(createUpgradePurchase(owned, 'armor', 'skyline-r34'), null);
  assert.equal(createUpgradePurchase({ ...owned, coins: 0 }, 'speed', 'skyline-r34'), null);
  assert.equal(createUpgradePurchase({
    ...owned,
    carUpgrades: {
      ...owned.carUpgrades,
      'skyline-r34': { ...owned.carUpgrades['skyline-r34'], speedLevel: 5 },
    },
  }, 'speed', 'skyline-r34'), null);
});

test('Rush rewards real early arrival while preserving target and late efficiency behavior', () => {
  const base = getNormalReward(3_000);
  const input = { orderType: 'express' as const, baseReward: base, targetTime: 60,
    passengerType: 'RUSH' as const, rideQuality: 100 };
  const atTarget = getOrderReward({ ...input, rideElapsed: 60 });
  const tenEarly = getOrderReward({ ...input, rideElapsed: 50 });
  const thirtyEarly = getOrderReward({ ...input, rideElapsed: 30 });
  const maximum = getOrderReward({ ...input, rideElapsed: 0 });
  const estimate = getEstimatedOrderReward({ ...input, rideElapsed: 0 });
  assert.equal(getRushEarlyRatio(60, 60), 0);
  assert.equal(getRushEarlyMoneyBonus(60, 60), 0);
  assert.ok(tenEarly > atTarget);
  assert.ok(thirtyEarly > tenEarly);
  assert.ok(maximum <= Math.ceil(atTarget * (1 + RUSH_MAX_EARLY_MONEY_BONUS)));
  assert.equal(estimate, atTarget);
  assert.ok(estimate < maximum, 'preview must not assume an instant-delivery early bonus');
  const lateElapsed = 75;
  const oldLateReward = Math.round(base * 1.25 *
    (0.65 + (1.7 - 0.65) * getExpressEfficiency(lateElapsed, 60)));
  assert.equal(getOrderReward({ ...input, rideElapsed: lateElapsed }), oldLateReward);
  assert.equal(getRushEarlyRatio(Number.NaN, Number.POSITIVE_INFINITY), 0);
  assert.ok(Number.isFinite(getOrderReward({ ...input, rideElapsed: Number.NaN, targetTime: Number.NaN })));

  const xpInput = { routeDistance: 3_000, passengerType: 'RUSH' as const,
    rideQuality: 100, strongCollisions: 0, rushSuccess: true, targetTime: 60 };
  assert.ok(calculateOrderXp({ ...xpInput, rideElapsed: 50 }) >
    calculateOrderXp({ ...xpInput, rideElapsed: 60 }));
  assert.ok(calculateOrderXp({ ...xpInput, rideElapsed: 30 }) >=
    calculateOrderXp({ ...xpInput, rideElapsed: 50 }));
});

test('Cautious aggression ignores ordinary inputs and applies mild smooth penalties above thresholds', () => {
  const normal = getCautiousAggressionSeverity({ speed: 150, maxSpeed: 340, brake: true, steer: 0.5, previousSteer: 0, dash: false });
  const sustainedTurn = getCautiousAggressionSeverity({ speed: 280, maxSpeed: 340, brake: false, steer: -1, previousSteer: -1, dash: false });
  const hardBrake = getCautiousAggressionSeverity({ speed: 280, maxSpeed: 340, brake: true, steer: 0, previousSteer: 0, dash: false });
  const sharpTurn = getCautiousAggressionSeverity({ speed: 260, maxSpeed: 340, brake: false, steer: -1, previousSteer: 1, dash: false });
  const dash = getCautiousAggressionSeverity({ speed: 100, maxSpeed: 340, brake: false, steer: 0, previousSteer: 0, dash: true });
  assert.equal(normal, 0);
  assert.equal(sustainedTurn, 0);
  assert.ok(hardBrake > 0 && hardBrake < 1);
  assert.ok(sharpTurn > 0 && sharpTurn < 1);
  assert.equal(dash, 1);

  const orders = new OrdersManager(new CityMap());
  const order = orders.startShift();
  order.status = 'in_transit';
  order.passengerType = 'CAUTIOUS';
  const initialQuality = order.rideQuality;
  for (let tick = 0; tick < 120; tick++) orders.recordAggressiveDriving(1 / 60, sustainedTurn);
  assert.equal(order.rideQuality, initialQuality);
  orders.recordAggressiveDriving(1 / 60, sharpTurn);
  assert.ok(order.rideQuality < initialQuality);
  assert.ok(order.rideQuality > initialQuality - 0.1);
  const beforeHardBrake = order.rideQuality;
  for (let tick = 0; tick < 60; tick++) orders.recordAggressiveDriving(1 / 60, hardBrake);
  assert.ok(order.rideQuality < beforeHardBrake);
  assert.ok(order.rideQuality > beforeHardBrake - 2);
  const beforeCollision = order.rideQuality;
  assert.ok(orders.recordStrongCollision(0.8) > 0);
  assert.ok(order.rideQuality < beforeCollision);
});

test('old saves migrate driver progression without changing existing economy fields', () => {
  const migrated = migrateSaveData({
    coins: 777, fuel: 42, ordersCompleted: 9,
    driverXp: Number.POSITIVE_INFINITY,
    perfectRides: -10,
    totalShifts: Number.NaN,
  });
  assert.equal(migrated.coins, 777);
  assert.equal(migrated.fuel, 42);
  assert.equal(migrated.ordersCompleted, 9);
  assert.equal(migrated.driverXp, 0);
  assert.equal(migrated.perfectRides, 0);
  assert.equal(migrated.totalShifts, 0);
});

test('shift score is deterministic, clamped and responds to quality events', () => {
  const clean = {
    ...createShiftStats(0, 1_000), completedOrders: 6, earnings: 2_000,
    xpEarned: 600, perfectRides: 5, vipRides: 2, rushSuccesses: 2,
    totalRideQuality: 570, totalVipQuality: 190,
  };
  const rough = { ...clean, collisions: 5, rejectedOrders: 3, perfectRides: 0, totalRideQuality: 300 };
  assert.ok(calculateShiftScore(clean) >= 80);
  assert.ok(calculateShiftScore(rough) < calculateShiftScore(clean));
  assert.ok(calculateShiftScore({ ...clean, perfectRides: 6 }) > calculateShiftScore({ ...clean, perfectRides: 0 }));
  assert.equal(scoreToRating(90), 'S');
  assert.equal(scoreToRating(80), 'A');
  assert.equal(scoreToRating(65), 'B');
  assert.equal(scoreToRating(50), 'C');
  assert.equal(scoreToRating(49), 'D');
  assert.ok(calculateShiftScore({ ...rough, collisions: 999 }) >= 0);
  assert.ok(calculateShiftScore({ ...clean, perfectRides: 999 }) <= 100);
  assert.ok(Number.isFinite(calculateShiftScore({ ...clean, totalRideQuality: Number.NaN })));
});

test('shift completion preserves permanent stats and only adds the completion XP bonus once', () => {
  const stats = { ...createShiftStats(500, 1_000), completedOrders: 4, earnings: 1_200,
    xpEarned: 400, perfectRides: 3, totalRideQuality: 380 };
  const before = { ...DEFAULT_SAVE_DATA, driverXp: 900, ordersCompleted: 12, totalEarnings: 5_000 };
  const completed = completeShift(before, stats, 61_000);
  assert.equal(completed.saveData.ordersCompleted, 12);
  assert.equal(completed.saveData.totalEarnings, 5_000);
  assert.equal(completed.saveData.totalShifts, 1);
  assert.equal(completed.saveData.driverXp, 900 + completed.result.completionBonusXp);

  const engine = createEngine(migrateSaveData(before));
  engine.startShift();
  engine.orders.cancelCurrentOrder();
  const first = engine.endShift();
  const xpAfterFirst = engine.saveData.driverXp;
  assert.ok(first);
  assert.equal(engine.getShiftStats(), null);
  assert.equal(engine.saveData.ordersCompleted, 12);
  assert.equal(engine.endShift(), null);
  assert.equal(engine.saveData.driverXp, xpAfterFirst);
});

test('garage-style shift completion counts rejection, saves result once and recovery preserves the shift', () => {
  const engine = createEngine();
  engine.startShift();
  const result = engine.cancelCurrentOrderAndEndShift();
  assert.ok(result);
  assert.equal(result.stats.rejectedOrders, 1);
  assert.equal(engine.saveData.totalShifts, 1);
  assert.equal(engine.saveData.bestShiftScore, result.score);
  const xpAfterResult = engine.saveData.driverXp;
  assert.equal(engine.cancelCurrentOrderAndEndShift(), null);
  assert.equal(engine.saveData.totalShifts, 1);
  assert.equal(engine.saveData.driverXp, xpAfterResult);

  const recoveryEngine = createEngine();
  recoveryEngine.startShift();
  const statsBeforeRecovery = recoveryEngine.getShiftStats();
  (recoveryEngine as unknown as { finishRecovery: () => void }).finishRecovery();
  assert.equal(recoveryEngine.orders.isShiftActive(), true);
  assert.equal(recoveryEngine.orders.getCurrentOrder(), null);
  assert.equal(recoveryEngine.getShiftStats()?.startedAt, statsBeforeRecovery?.startedAt);
  assert.equal(recoveryEngine.getShiftStats()?.rejectedOrders, 1);
  assert.equal(recoveryEngine.saveData.totalShifts, 0);
  assert.ok(recoveryEngine.requestNextOrder());
});
