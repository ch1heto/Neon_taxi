import assert from 'node:assert/strict';
import test from 'node:test';
import { Car } from '../src/game/Car';
import { CityMap } from '../src/game/CityMap';
import { GameEngine, type GameInputState } from '../src/game/GameEngine';
import { getNormalReward, getOrderReward } from '../src/game/OrderEconomy';
import { OrdersManager } from '../src/game/OrdersManager';
import {
  AUTO_DOCK_CAPTURE_DISTANCE,
  AUTO_DOCK_DURATION,
  AUTO_DOCK_MAX_SPEED,
  PassengerAutoDock,
} from '../src/game/PassengerAutoDock';
import { closestPointOnSegment, normalizeAngle } from '../src/game/geometry';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';
import type { ParkingZone } from '../src/types/game';

const idleInput: GameInputState = { forward: 0, reverse: 0, steer: 0, brake: false, dash: false };

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
}

function makeEngine(fuel = 75) {
  installEngineDomMocks();
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
  const engine = new GameEngine(canvas, migrateSaveData({ ...DEFAULT_SAVE_DATA, fuel }));
  engine.map.trafficCars = [];
  return engine;
}

function tickEngine(engine: GameEngine, dt = 1 / 60, input: GameInputState = idleInput) {
  (engine as unknown as { update: (step: number, controls: GameInputState) => void }).update(dt, input);
}

function approachPose(map: CityMap, zone: ParkingZone, distance = 88, angleOffset = 0.48) {
  const road = map.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId)!;
  const roadCenter = closestPointOnSegment(
    zone,
    { x: road.x1, y: road.y1 },
    { x: road.x2, y: road.y2 },
  );
  const towardRoadX = roadCenter.x - zone.x;
  const towardRoadY = roadCenter.y - zone.y;
  const length = Math.hypot(towardRoadX, towardRoadY) || 1;
  return {
    x: zone.x + towardRoadX / length * distance,
    y: zone.y + towardRoadY / length * distance,
    angle: zone.angle + angleOffset,
  };
}

function placeForDock(engine: GameEngine, zone: ParkingZone, distance = 88, angleOffset = 0.48) {
  const pose = approachPose(engine.map, zone, distance, angleOffset);
  engine.car.recoverAt(pose.x, pose.y, pose.angle);
  return pose;
}

function activePickup(map: CityMap) {
  const orders = new OrdersManager(map);
  const order = orders.spawnOrder();
  const zone = map.parkingZones.find(candidate => candidate.id === order.pickupZoneId)!;
  return { order, zone };
}

test('auto-dock stays inactive when far away, too fast, or behind the active bay', () => {
  const map = new CityMap();
  map.trafficCars = [];
  const { order, zone } = activePickup(map);

  const farPose = approachPose(map, zone, AUTO_DOCK_CAPTURE_DISTANCE + 1);
  const farCar = new Car(farPose.x, farPose.y);
  farCar.angle = farPose.angle;
  const farAssist = new PassengerAutoDock(map);
  assert.equal(farAssist.update(1 / 60, farCar, order).controlsSuppressed, false);
  assert.equal(farAssist.isActive(), false);

  const nearPose = approachPose(map, zone, 75);
  const fastCar = new Car(nearPose.x, nearPose.y);
  fastCar.angle = nearPose.angle;
  fastCar.speed = AUTO_DOCK_MAX_SPEED + 0.1;
  fastCar.vx = Math.cos(fastCar.angle) * fastCar.speed;
  fastCar.vy = Math.sin(fastCar.angle) * fastCar.speed;
  const fastAssist = new PassengerAutoDock(map);
  assert.equal(fastAssist.update(1 / 60, fastCar, order).controlsSuppressed, false);

  const roadPose = approachPose(map, zone, 40, 0);
  const outwardX = zone.x - roadPose.x;
  const outwardY = zone.y - roadPose.y;
  const outwardLength = Math.hypot(outwardX, outwardY) || 1;
  const rearCar = new Car(
    zone.x + outwardX / outwardLength * 24,
    zone.y + outwardY / outwardLength * 24,
  );
  rearCar.angle = zone.angle;
  const rearAssist = new PassengerAutoDock(map);
  assert.equal(rearAssist.update(1 / 60, rearCar, order).controlsSuppressed, false);
});

test('near and slow capture eases position and shortest angle without a one-frame teleport', () => {
  const map = new CityMap();
  map.trafficCars = [];
  const { order, zone } = activePickup(map);
  const start = approachPose(map, zone, 92, 0.6);
  const car = new Car(start.x, start.y);
  car.angle = start.angle;
  const assist = new PassengerAutoDock(map);
  const startDistance = Math.hypot(zone.x - car.x, zone.y - car.y);
  const startAngleError = Math.abs(normalizeAngle(zone.angle - car.angle));

  const first = assist.update(1 / 60, car, order);
  const firstMovement = Math.hypot(car.x - start.x, car.y - start.y);
  assert.equal(first.captured, true);
  assert.equal(first.controlsSuppressed, true);
  assert.equal(assist.isActive(), true);
  assert.ok(firstMovement > 0 && firstMovement < startDistance * 0.02);
  assert.ok(Math.abs(normalizeAngle(zone.angle - car.angle)) < startAngleError);
  assert.ok(Math.abs(normalizeAngle(zone.angle - car.angle)) > 0, 'angle snapped in one frame');

  const steps = Math.ceil(AUTO_DOCK_DURATION * 60) + 1;
  for (let index = 1; index < steps; index++) assist.update(1 / 60, car, order);
  assert.equal(assist.isActive(), false);
  assert.ok(Math.hypot(zone.x - car.x, zone.y - car.y) < 1e-6);
  assert.ok(Math.abs(normalizeAngle(zone.angle - car.angle)) < 1e-6);
  assert.equal(car.speed, 0);
});

test('unsafe swept vehicle path blocks capture before the car moves', () => {
  const map = new CityMap();
  map.trafficCars = [];
  const { order, zone } = activePickup(map);
  const start = approachPose(map, zone, 90, 0.3);
  const car = new Car(start.x, start.y);
  car.angle = start.angle;
  const unsafeMap = Object.create(map) as CityMap;
  unsafeMap.checkVehicleCollision = pose =>
    Math.hypot(pose.x - start.x, pose.y - start.y) > 18
      ? { hit: true, normalX: 1, normalY: 0, overlap: 1 }
      : null;
  unsafeMap.checkIslandBoundary = () => null;
  unsafeMap.checkTrafficCollision = () => null;
  const assist = new PassengerAutoDock(unsafeMap);

  const result = assist.update(1 / 60, car, order);
  assert.equal(result.controlsSuppressed, false);
  assert.equal(assist.isActive(), false);
  assert.deepEqual({ x: car.x, y: car.y, angle: car.angle }, start);
});

test('auto-dock completes pickup and Normal dropoff without replacing parking validation or reward', () => {
  const engine = makeEngine(80);
  const order = engine.startShift();
  order.orderType = 'normal';
  order.passengerType = 'NORMAL';
  const expectedReward = getNormalReward(order.routeDistance);
  assert.equal(order.baseReward, expectedReward);
  const pickup = engine.map.parkingZones.find(zone => zone.id === order.pickupZoneId)!;
  placeForDock(engine, pickup);
  for (let tick = 0; tick < 90 && order.status === 'pickup'; tick++) tickEngine(engine);
  assert.equal(order.status, 'in_transit');
  assert.equal(order.rideElapsed, 0, 'ride timer ran before pickup');

  const destination = engine.map.parkingZones.find(zone => zone.id === order.destinationZoneId)!;
  placeForDock(engine, destination);
  for (let tick = 0; tick < 90 && engine.orders.getCurrentOrder(); tick++) tickEngine(engine);
  assert.equal(order.status as string, 'completed');
  assert.equal(engine.orders.getCurrentOrder(), null);
  assert.equal(engine.saveData.coins, DEFAULT_SAVE_DATA.coins + expectedReward);
  engine.stop();
});

test('Express timer and reward formula continue during docking while fuel tracks the small movement', () => {
  const engine = makeEngine(50);
  const order = engine.startShift();
  order.status = 'in_transit';
  order.orderType = 'express';
  order.passengerType = 'RUSH';
  order.rideElapsed = 8;
  const originalBaseReward = order.baseReward;
  const originalTargetTime = order.targetTime;
  const destination = engine.map.parkingZones.find(zone => zone.id === order.destinationZoneId)!;
  placeForDock(engine, destination, 90, 0.5);
  const fuelBefore = engine.saveData.fuel;

  tickEngine(engine, 0.1);
  assert.ok(Math.abs(order.rideElapsed - 8.1) < 1e-9);
  assert.equal(order.baseReward, originalBaseReward);
  assert.equal(order.targetTime, originalTargetTime);
  assert.equal(getOrderReward(order), getOrderReward({
    orderType: 'express',
    baseReward: originalBaseReward,
    targetTime: originalTargetTime,
    rideElapsed: 8.1,
    passengerType: 'RUSH',
    rideQuality: order.rideQuality,
  }));
  for (let tick = 0; tick < 6; tick++) tickEngine(engine, 0.1);
  assert.ok(engine.saveData.fuel < fuelBefore, 'assisted displacement did not consume fuel');
  assert.ok(engine.saveData.fuel > fuelBefore - 1, 'assisted displacement caused anomalous fuel use');
  assert.ok(engine.saveData.fuel >= 0 && engine.saveData.fuel <= 100);
  engine.stop();
});

test('cancel, destination change, pause and refuse clear assist without leaving controls locked', () => {
  const engine = makeEngine();
  const order = engine.startShift();
  const pickup = engine.map.parkingZones.find(zone => zone.id === order.pickupZoneId)!;
  placeForDock(engine, pickup);
  tickEngine(engine);
  assert.equal(engine.passengerAutoDock.isActive(), true);

  engine.orders.cancelCurrentOrder();
  tickEngine(engine, 1 / 60, { ...idleInput, forward: 1 });
  assert.equal(engine.passengerAutoDock.isActive(), false);
  assert.equal(engine.isPassengerAutoDockIndicatorVisible(), false);
  assert.ok(engine.car.speed > 0, 'controls stayed suppressed after order cancellation');

  const next = engine.requestNextOrder()!;
  const nextPickup = engine.map.parkingZones.find(zone => zone.id === next.pickupZoneId)!;
  placeForDock(engine, nextPickup);
  tickEngine(engine);
  assert.equal(engine.passengerAutoDock.isActive(), true);
  next.pickupZoneId = engine.map.parkingZones.find(zone => zone.id !== next.pickupZoneId)!.id;
  tickEngine(engine);
  assert.equal(engine.passengerAutoDock.isActive(), false, 'stale target survived a destination change');

  next.pickupZoneId = nextPickup.id;
  placeForDock(engine, nextPickup);
  tickEngine(engine);
  engine.setPaused(true);
  assert.equal(engine.passengerAutoDock.isActive(), false);
  engine.setPaused(false);

  placeForDock(engine, nextPickup);
  tickEngine(engine);
  engine.refuseOrder();
  assert.equal(engine.passengerAutoDock.isActive(), false);
  assert.equal(engine.orders.getCurrentOrder(), null);
  assert.equal(engine.orders.isShiftActive(), true);
  assert.equal(engine.getShiftStats()?.rejectedOrders, 1);
  engine.stop();
});
