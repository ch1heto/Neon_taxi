import assert from 'node:assert/strict';
import test from 'node:test';
import { Car, type DrivingSurface } from '../src/game/Car';
import { CityMap } from '../src/game/CityMap';
import {
  analyzeFuelStationCoverage,
  clampFuel,
  consumeFuelForDistance,
  consumeFuelForMovement,
  createRefuelPurchase,
  EMPTY_TANK_SPEED_MULTIPLIER,
  FUEL_PER_WORLD_UNIT,
  FULL_TANK_PRICE,
  FULL_TANK_RANGE_WORLD_UNITS,
  fuelSpeedMultiplier,
  refuelPrice,
  stationContainsPoint,
} from '../src/game/FuelSystem';
import { GameEngine } from '../src/game/GameEngine';
import { CAR_SKINS } from '../src/game/Skins';
import { TestDriveSession } from '../src/game/TestDriveTrack';
import { pointInRoadCorridor } from '../src/game/geometry';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';

const clearSurface: DrivingSurface = {
  width: 100_000,
  height: 100_000,
  checkVehicleCollision: () => null,
  checkIslandBoundary: () => null,
  checkTrafficCollision: () => null,
};
const throttle = { forward: 1, reverse: 0, steer: 0, brake: false, dash: false };

function installEngineDomMocks() {
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    addEventListener: () => {},
    removeEventListener: () => {},
  } });
  return saved;
}

function makeEngine(fuel: number, coins = 100) {
  installEngineDomMocks();
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
  return new GameEngine(canvas, migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel, coins }));
}

test('fuel migration defaults legacy saves to 100 and clamps loaded values to 0..100', () => {
  const legacy = migrateSaveData({ coins: 321 });
  assert.equal(legacy.fuel, 100);
  assert.equal(migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel: -12 }).fuel, 0);
  assert.equal(migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel: 140 }).fuel, 100);
  assert.equal(migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel: Number.NaN }).fuel, 100);
  assert.equal(clampFuel(54.5), 54.5);
});

test('fuel consumption is distance-based, FPS-independent and ignores idle or teleport displacement', () => {
  assert.equal(consumeFuelForMovement(80, { x: 10, y: 10 }, { x: 10, y: 10 }, true), 80);
  assert.equal(consumeFuelForMovement(80, { x: 0, y: 0 }, { x: 1000, y: 1000 }, true), 80);
  assert.equal(consumeFuelForMovement(80, { x: 0, y: 0 }, { x: 3, y: 4 }, false), 80,
    'paused/menu movement consumed fuel');
  const movedFive = consumeFuelForMovement(80, { x: 0, y: 0 }, { x: 3, y: 4 }, true);
  assert.ok(Math.abs(movedFive - (80 - 5 * FUEL_PER_WORLD_UNIT)) < 1e-10);

  let sixtyFpsFuel = 100;
  for (let frame = 0; frame < 600; frame++) sixtyFpsFuel = consumeFuelForDistance(sixtyFpsFuel, 1);
  let lowFpsFuel = 100;
  for (let frame = 0; frame < 60; frame++) lowFpsFuel = consumeFuelForDistance(lowFpsFuel, 10);
  assert.ok(Math.abs(sixtyFpsFuel - lowFpsFuel) < 1e-9);
});

test('a full tank represents the configured 800,000-world-unit range', () => {
  assert.equal(FULL_TANK_RANGE_WORLD_UNITS, 800_000);
  const fuelAfterDistance = (totalDistance: number) => {
    let fuel = 100;
    for (let distance = 0; distance < totalDistance; distance += 100) {
      fuel = consumeFuelForDistance(fuel, Math.min(100, totalDistance - distance));
    }
    return fuel;
  };
  assert.ok(Math.abs(fuelAfterDistance(200_000) - 75) < 1e-9);
  assert.ok(Math.abs(fuelAfterDistance(400_000) - 50) < 1e-9);
  assert.ok(fuelAfterDistance(800_000) < 1e-9);
});

test('fuel speed curve matches 100/60/40/20/0 breakpoints and begins below 60', () => {
  assert.equal(fuelSpeedMultiplier(100), 1);
  assert.equal(fuelSpeedMultiplier(60), 1);
  assert.ok(fuelSpeedMultiplier(59.9) < 1);
  assert.ok(Math.abs(fuelSpeedMultiplier(40) - 0.75) < 1e-12);
  assert.ok(Math.abs(fuelSpeedMultiplier(20) - 0.5) < 1e-12);
  assert.equal(fuelSpeedMultiplier(0), EMPTY_TANK_SPEED_MULTIPLIER);
});

test('zero fuel keeps a 25% limp-home speed without mutating base maxSpeed', () => {
  const car = new Car(50_000, 50_000);
  car.applyUpgrades({ speedLevel: 3, handlingLevel: 2, dashLevel: 4 }, CAR_SKINS[0]);
  const baseMaxSpeed = car.maxSpeed;
  car.setRuntimePerformanceMultiplier(fuelSpeedMultiplier(0));
  for (let tick = 0; tick < 600; tick++) car.update(1 / 60, throttle, clearSurface, CAR_SKINS[0]);
  assert.equal(car.maxSpeed, baseMaxSpeed);
  assert.ok(car.speed > baseMaxSpeed * 0.23);
  assert.ok(car.speed <= baseMaxSpeed * 0.25 + 0.01);
});

test('Dash remains useful but scales with the fuel-limited performance ceiling', () => {
  const full = new Car(50_000, 50_000);
  const empty = new Car(50_000, 50_000);
  for (const car of [full, empty]) car.applyUpgrades({ speedLevel: 1, handlingLevel: 1, dashLevel: 5 }, CAR_SKINS[0]);
  full.setRuntimePerformanceMultiplier(1);
  empty.setRuntimePerformanceMultiplier(fuelSpeedMultiplier(0));
  assert.equal(full.triggerDash(), true);
  assert.equal(empty.triggerDash(), true);
  for (let tick = 0; tick < 18; tick++) {
    full.update(1 / 60, throttle, clearSurface, CAR_SKINS[0]);
    empty.update(1 / 60, throttle, clearSurface, CAR_SKINS[0]);
  }
  assert.equal(empty.isDashing, true);
  assert.ok(empty.speed > 0);
  assert.ok(empty.speed <= empty.maxSpeed * EMPTY_TANK_SPEED_MULTIPLIER * 1.5 + 0.01);
  assert.ok(empty.speed < full.speed * 0.35, 'low-fuel Dash bypassed the fuel restriction');
  assert.equal(empty.dashDuration, 0.45);
});

test('refuel price scales with missing fuel and insufficient funds are atomic', () => {
  assert.equal(FULL_TANK_PRICE, 70);
  assert.equal(refuelPrice(100), 0);
  assert.equal(refuelPrice(50), 35);
  assert.equal(refuelPrice(0), 70);
  const poor = migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel: 50, coins: 34 });
  const result = createRefuelPurchase(poor);
  assert.deepEqual(result, { status: 'insufficientFunds', cost: 35 });
  assert.equal(poor.coins, 34);
  assert.equal(poor.fuel, 50);

  const paid = createRefuelPurchase({ ...poor, coins: 100 });
  assert.equal(paid.status, 'success');
  if (paid.status !== 'success') return;
  assert.equal(paid.cost, 35);
  assert.equal(paid.saveData.coins, 65);
  assert.equal(paid.saveData.fuel, 100);
});

test('exactly four accessible roadside fuel stations cover every parking zone', () => {
  const map = new CityMap();
  assert.equal(map.fuelStations.length, 4);
  assert.deepEqual(map.validateFuelStations().filter(result => !result.valid), []);
  for (const station of map.fuelStations) {
    const road = map.roadSegments.find(candidate => candidate.id === station.accessRoadSegmentId);
    assert.ok(road, `${station.id} has no access road`);
    assert.notEqual(road!.kind, 'alley');
    assert.equal(stationContainsPoint(station, station.x, station.y), true);
    assert.equal(pointInRoadCorridor(
      station,
      { x: road!.x1, y: road!.y1 },
      { x: road!.x2, y: road!.y2 },
      road!.width,
    ), false, `${station.id} occupies a traffic lane`);
  }
  const coverage = analyzeFuelStationCoverage(map);
  assert.ok(coverage.maxRouteDistance <= 4500,
    `${coverage.worstPointId} is ${coverage.maxRouteDistance.toFixed(1)} units from fuel`);
  assert.ok(coverage.minStationRouteDistance >= 1800,
    `stations cluster at ${coverage.minStationRouteDistance.toFixed(1)} route units`);
});

test('Test Drive driving and tuning never consume or modify career fuel', () => {
  const career = migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel: 12.5 });
  const before = structuredClone(career);
  const session = new TestDriveSession(CAR_SKINS[CAR_SKINS.length - 1]);
  session.setUpgradeLevel('speed', 5);
  session.setUpgradeLevel('handling', 5);
  session.setUpgradeLevel('dash', 5);
  for (let tick = 0; tick < 300; tick++) session.update(1 / 60, throttle);
  assert.deepEqual(career, before);
  assert.equal(session.car.runtimePerformanceMultiplier, 1);
});

test('fuel survives save/reload and switching cars cannot refill the shared career tank', () => {
  const saved = migrateSaveData(JSON.parse(JSON.stringify({ ...DEFAULT_SAVE_DATA, fuel: 7.25 })));
  assert.equal(saved.fuel, 7.25);
  const engine = makeEngine(7.25, 5000);
  const maxSpeedBefore = engine.car.maxSpeed;
  engine.updateSkin('sport');
  assert.equal(engine.saveData.fuel, 7.25);
  assert.notEqual(engine.car.maxSpeed, maxSpeedBefore);
  assert.equal(engine.car.runtimePerformanceMultiplier, fuelSpeedMultiplier(7.25));
  engine.stop();
});

test('manual refuel works during an active Express timer without pausing it', () => {
  const engine = makeEngine(50, 100);
  const station = engine.map.fuelStations[0];
  Object.assign(engine.car, { x: station.x, y: station.y, vx: 0, vy: 0, speed: 0 });
  const order = engine.startShift();
  order.orderType = 'express';
  order.status = 'in_transit';
  order.rideElapsed = 8;
  assert.equal(engine.tryRefuel(), true);
  assert.equal(engine.saveData.fuel, 100);
  assert.equal(engine.saveData.coins, 65);
  engine.orders.update(1, {
    x: engine.car.x,
    y: engine.car.y,
    vx: 0,
    vy: 0,
    angle: engine.car.angle,
    length: engine.car.length,
    width: engine.car.width,
  });
  assert.equal(order.rideElapsed, 9);
  engine.stop();
});
