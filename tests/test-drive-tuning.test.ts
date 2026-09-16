import assert from 'node:assert/strict';
import test from 'node:test';
import { Car } from '../src/game/Car';
import { speedToKmh as engineSpeedToKmh } from '../src/game/GameEngine';
import { CAR_SKINS } from '../src/game/Skins';
import { DEFAULT_TEST_DRIVE_LEVELS, TestDriveSession } from '../src/game/TestDriveTrack';
import { speedToKmh } from '../src/game/VehicleMetrics';
import { DEFAULT_SAVE_DATA } from '../src/services/YandexAPI';

const idle = { forward: 0, reverse: 0, steer: 0, brake: false, dash: false };
const throttle = { ...idle, forward: 1 };
const skin = CAR_SKINS.find(candidate => candidate.id === 'hyper')!;

function physics(car: Car) {
  return {
    maxSpeed: car.maxSpeed,
    acceleration: car.acceleration,
    braking: car.braking,
    turnSpeed: car.turnSpeed,
    lateralGrip: car.lateralGrip,
    dashSpeedBoost: car.dashSpeedBoost,
    dashCooldownMax: car.dashCooldownMax,
  };
}

function configuredCar(levels: { speedLevel: number; handlingLevel: number; dashLevel: number }) {
  const car = new Car(0, 0);
  car.applyUpgrades(levels, skin);
  return car;
}

test('a new Test Drive session always starts with temporary 1/1/1 levels', () => {
  const session = new TestDriveSession(skin);
  assert.deepEqual(session.levels, DEFAULT_TEST_DRIVE_LEVELS);
  assert.deepEqual(physics(session.car), physics(configuredCar(DEFAULT_TEST_DRIVE_LEVELS)));
});

test('Test Drive speed level 1 -> 5 uses the same model-based speed formula', () => {
  const session = new TestDriveSession(skin);
  const levelOne = physics(session.car);
  assert.equal(session.setUpgradeLevel('speed', 5), true);
  const levelFive = physics(session.car);
  const expected = physics(configuredCar({ speedLevel: 5, handlingLevel: 1, dashLevel: 1 }));
  assert.deepEqual(levelFive, expected);
  assert.ok(levelFive.maxSpeed > levelOne.maxSpeed);
  assert.ok(levelFive.acceleration > levelOne.acceleration);
  assert.equal(levelFive.braking, levelOne.braking);
  assert.equal(levelFive.dashSpeedBoost, levelOne.dashSpeedBoost);
});

test('Test Drive handling level only changes the existing handling characteristics', () => {
  const session = new TestDriveSession(skin);
  const levelOne = physics(session.car);
  session.setUpgradeLevel('handling', 5);
  const levelFive = physics(session.car);
  assert.ok(levelFive.braking > levelOne.braking);
  assert.ok(levelFive.turnSpeed > levelOne.turnSpeed);
  assert.ok(levelFive.lateralGrip > levelOne.lateralGrip);
  assert.equal(levelFive.maxSpeed, levelOne.maxSpeed);
  assert.equal(levelFive.acceleration, levelOne.acceleration);
  assert.equal(levelFive.dashSpeedBoost, levelOne.dashSpeedBoost);
  assert.equal(levelFive.dashCooldownMax, levelOne.dashCooldownMax);
});

test('Test Drive dash level only changes the existing Dash characteristics', () => {
  const session = new TestDriveSession(skin);
  const levelOne = physics(session.car);
  session.setUpgradeLevel('dash', 5);
  const levelFive = physics(session.car);
  assert.ok(levelFive.dashSpeedBoost > levelOne.dashSpeedBoost);
  assert.ok(levelFive.dashCooldownMax < levelOne.dashCooldownMax);
  assert.equal(levelFive.maxSpeed, levelOne.maxSpeed);
  assert.equal(levelFive.acceleration, levelOne.acceleration);
  assert.equal(levelFive.braking, levelOne.braking);
  assert.equal(levelFive.turnSpeed, levelOne.turnSpeed);
  assert.equal(levelFive.lateralGrip, levelOne.lateralGrip);
});

test('Test Drive levels clamp to integers in 1..5 and reject non-finite input safely', () => {
  const session = new TestDriveSession(skin);
  session.setUpgradeLevel('speed', 99);
  session.setUpgradeLevel('handling', -10);
  session.setUpgradeLevel('dash', 3.4);
  assert.deepEqual(session.levels, { speedLevel: 5, handlingLevel: 1, dashLevel: 3 });
  session.setUpgradeLevel('speed', Number.NaN);
  session.setUpgradeLevel('handling', Number.POSITIVE_INFINITY);
  session.setUpgradeLevel('dash', undefined as unknown as number);
  assert.deepEqual(session.levels, { speedLevel: 5, handlingLevel: 1, dashLevel: 3 });
  for (let click = 0; click < 20; click++) {
    session.setUpgradeLevel('dash', session.levels.dashLevel + 1);
  }
  assert.equal(session.levels.dashLevel, 5);
  assert.ok(Object.values(physics(session.car)).every(Number.isFinite));
});

test('configuration changes reset the car and all configuration-scoped telemetry', () => {
  const session = new TestDriveSession(skin);
  for (let tick = 0; tick < 180; tick++) session.update(1 / 60, throttle);
  session.bestLap = 42;
  assert.ok(session.maxSpeedKmh > 0 && session.lapElapsed > 0);
  const generation = session.resetGeneration;
  session.setUpgradeLevel('speed', 2);
  assert.equal(session.resetGeneration, generation + 1);
  assert.equal(session.car.x, session.track.start.x);
  assert.equal(session.car.y, session.track.start.y);
  assert.equal(session.car.speed, 0);
  assert.equal(session.maxSpeedKmh, 0);
  assert.equal(session.zeroToHundred, null);
  assert.equal(session.lapElapsed, 0);
  assert.equal(session.bestLap, null);
});

test('Test Drive does not mutate career stats, ownership, coins or selected car', () => {
  const career = structuredClone({
    ...DEFAULT_SAVE_DATA,
    coins: 4321,
    selectedSkinId: 'cruiser',
    unlockedSkinIds: ['cruiser'],
    stats: { speedLevel: 4, handlingLevel: 3, dashLevel: 2 },
  });
  const before = structuredClone(career);
  const lockedSkin = CAR_SKINS.find(candidate => !career.unlockedSkinIds.includes(candidate.id))!;
  const session = new TestDriveSession(lockedSkin);
  session.setUpgradeLevel('speed', 5);
  session.setUpgradeLevel('handling', 5);
  session.setUpgradeLevel('dash', 5);
  for (let tick = 0; tick < 120; tick++) session.update(1 / 60, throttle);
  assert.deepEqual(career, before);
  assert.equal(career.unlockedSkinIds.includes(lockedSkin.id), false);
  assert.equal(career.coins, 4321);
  assert.equal(career.selectedSkinId, 'cruiser');
  assert.deepEqual(career.stats, { speedLevel: 4, handlingLevel: 3, dashLevel: 2 });
});

test('identical model and levels produce identical career and Test Drive physics without stacking', () => {
  const levels = { speedLevel: 3, handlingLevel: 2, dashLevel: 4 };
  const careerCar = configuredCar(levels);
  const session = new TestDriveSession(skin);
  session.setUpgradeLevel('speed', levels.speedLevel);
  session.setUpgradeLevel('handling', levels.handlingLevel);
  session.setUpgradeLevel('dash', levels.dashLevel);
  assert.deepEqual(physics(session.car), physics(careerCar));

  session.setUpgradeLevel('speed', 5);
  session.setUpgradeLevel('speed', 1);
  session.setUpgradeLevel('speed', levels.speedLevel);
  assert.deepEqual(physics(session.car), physics(careerCar), 'upgrade applications accumulated on prior values');
});

test('city and Test Drive share the same speedToKmh function', () => {
  assert.equal(engineSpeedToKmh, speedToKmh);
  assert.equal(speedToKmh(510), 170);
  const session = new TestDriveSession(skin);
  session.car.vx = 300;
  session.car.speed = 300;
  session.update(1 / 60, idle);
  assert.equal(session.maxSpeedKmh, speedToKmh(session.car.speed));
});

test('Dash remains active at 0.30 s and ends at about 0.45 s without a speed snap', () => {
  const session = new TestDriveSession(skin);
  const car = session.car;
  assert.equal(car.dashDuration, 0.45);
  car.vx = car.maxSpeed;
  car.speed = car.maxSpeed;
  assert.equal(car.triggerDash(), true);
  for (let tick = 0; tick < 18; tick++) session.update(1 / 60, throttle);
  assert.equal(car.isDashing, true, 'Dash ended at the old 0.25 s duration');
  assert.ok((car as unknown as { ghostTrails: unknown[] }).ghostTrails.length > 0,
    'afterimages stopped before Dash ended');

  let elapsed = 0.30;
  while (car.isDashing && elapsed < 0.6) {
    const before = car.speed;
    session.update(1 / 60, throttle);
    elapsed += 1 / 60;
    if (!car.isDashing) assert.ok(before - car.speed < 5, 'speed snapped down when Dash ended');
  }
  assert.ok(elapsed >= 0.44 && elapsed <= 0.47, `Dash ended at ${elapsed.toFixed(3)} s`);
});

test('Dash cooldown keeps counting down and blocks repeated Dash', () => {
  const session = new TestDriveSession(skin);
  const car = session.car;
  assert.equal(car.triggerDash(), true);
  const fullCooldown = car.dashCooldownTimer;
  assert.equal(car.triggerDash(), false);
  session.update(0.30, throttle);
  const partialCooldown = car.dashCooldownTimer;
  assert.ok(partialCooldown < fullCooldown && partialCooldown > 0);
  assert.equal(car.triggerDash(), false);
  for (let tick = 0; tick < 360 && car.dashCooldownTimer > 0; tick++) session.update(1 / 60, idle);
  assert.equal(car.dashCooldownTimer, 0);
  assert.equal(car.triggerDash(), true);
});
