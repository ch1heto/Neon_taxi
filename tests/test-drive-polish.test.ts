import assert from 'node:assert/strict';
import test from 'node:test';
import { CAR_SKINS } from '../src/game/Skins';
import { vehicleCollisionCircles, normalizeAngle } from '../src/game/geometry';
import { TestDriveMotion } from '../src/game/TestDriveInterpolation';
import { TEST_DRIVE_ASPHALT_HALF_WIDTH, TestDriveSession } from '../src/game/TestDriveTrack';

const idle = { forward: 0, reverse: 0, steer: 0, brake: false, dash: false };
const makeSession = () => new TestDriveSession(CAR_SKINS[0]);

function assertInside(session: TestDriveSession, tolerance = 0.25) {
  for (const circle of vehicleCollisionCircles(session.car)) {
    const projection = session.track.project(circle);
    assert.ok(projection.distance + circle.radius <= TEST_DRIVE_ASPHALT_HALF_WIDTH + tolerance,
      `vehicle circle beyond rail by ${(projection.distance + circle.radius - TEST_DRIVE_ASPHALT_HALF_WIDTH).toFixed(3)}`);
  }
}

test('closest centerline projection exposes segment, point, tangent, normal and progress', () => {
  const track = makeSession().track;
  const p = track.project({ x: 2000, y: 850 });
  assert.ok(p.segment >= 0 && p.segment < track.points.length - 1);
  assert.ok(Math.abs(p.closest.x - 2000) < 0.01 && Math.abs(p.closest.y - 800) < 0.01);
  assert.ok(Math.abs(p.distance - 50) < 0.01);
  assert.ok(Math.abs(Math.hypot(p.tangent.x, p.tangent.y) - 1) < 1e-9);
  assert.ok(Math.abs(p.tangent.x * p.normal.x + p.tangent.y * p.normal.y) < 1e-9);
  assert.ok(p.progress > 0 && p.progress < track.length);
});

test('straight rail returns an inward Contact at the visible asphalt edge', () => {
  const session = makeSession();
  const car = session.car;
  car.x = 2000;
  car.y = 800 + TEST_DRIVE_ASPHALT_HALF_WIDTH - car.collisionRadius - 2;
  assert.equal(session.track.checkVehicleCollision(car), null);
  car.y += 8;
  const hit = session.track.checkVehicleCollision(car);
  assert.ok(hit && hit.overlap >= 5.9 && hit.overlap <= 6.1);
  assert.ok(hit.normalY < -0.99);
});

test('curved rail produces an inward Contact for the vehicle circles', () => {
  const session = makeSession();
  const track = session.track;
  const a = track.points[20];
  const b = track.points[21];
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const projection = track.project(center);
  assert.ok(Math.abs(projection.tangent.y) > 0.03, 'fixture must be a bend');
  const car = session.car;
  car.angle = Math.atan2(projection.tangent.y, projection.tangent.x);
  car.x = center.x + projection.normal.x * (TEST_DRIVE_ASPHALT_HALF_WIDTH - car.collisionRadius + 7);
  car.y = center.y + projection.normal.y * (TEST_DRIVE_ASPHALT_HALF_WIDTH - car.collisionRadius + 7);
  const hit = track.checkVehicleCollision(car);
  assert.ok(hit && hit.overlap > 0);
  const fromTrack = track.project(car);
  const inward = { x: fromTrack.closest.x - car.x, y: fromTrack.closest.y - car.y };
  assert.ok(hit.normalX * inward.x + hit.normalY * inward.y > 0);
});

test('repeated straight and corner impacts stay in corridor without teleport or emergency reset', () => {
  const session = makeSession();
  const track = session.track;
  const bendA = track.points[20];
  const bendB = track.points[21];
  for (const fixture of [
    track.project({ x: 2000, y: 800 }),
    track.project({ x: (bendA.x + bendB.x) / 2, y: (bendA.y + bendB.y) / 2 }),
  ]) {
    session.car.x = fixture.closest.x + fixture.normal.x * (TEST_DRIVE_ASPHALT_HALF_WIDTH - session.car.collisionRadius - 2);
    session.car.y = fixture.closest.y + fixture.normal.y * (TEST_DRIVE_ASPHALT_HALF_WIDTH - session.car.collisionRadius - 2);
    session.car.angle = Math.atan2(fixture.tangent.y, fixture.tangent.x);
    for (let tick = 0; tick < 120; tick++) {
      session.car.vx = fixture.normal.x * 180;
      session.car.vy = fixture.normal.y * 180;
      session.car.speed = 180;
      const before = { x: session.car.x, y: session.car.y };
      session.update(1 / 60, idle);
      assertInside(session);
      assert.ok(Math.hypot(session.car.x - before.x, session.car.y - before.y) < 15,
        'ordinary rail contact must resolve locally, not teleport to the start');
      assert.equal(session.emergencyResetCount, 0);
    }
  }
  assert.equal(session.resetGeneration, 0);
});

test('manual Test Drive reset returns the car to the start and clears motion history', () => {
  const session = makeSession();
  const motion = new TestDriveMotion(session.car);
  session.update(1 / 60, { ...idle, forward: 1 });
  motion.step(session.car);
  session.reset();
  motion.reset(session.car);
  assert.deepEqual(motion.sample(0.4), { x: session.track.start.x, y: session.track.start.y, angle: session.track.start.angle });
  assert.equal(session.car.speed, 0);
  assert.equal(session.resetGeneration, 1);
  assert.equal(session.emergencyResetCount, 0);
});

test('shortest-angle interpolation crosses the angle wrap without a full spin', () => {
  const motion = new TestDriveMotion({ x: 0, y: 0, angle: Math.PI - 0.1 });
  motion.step({ x: 20, y: -4, angle: -Math.PI + 0.1 });
  const mid = motion.sample(0.5);
  assert.equal(mid.x, 10);
  assert.equal(mid.y, -2);
  assert.ok(Math.abs(normalizeAngle(mid.angle - Math.PI)) < 1e-9);
});

test('fixed 60 Hz physics interpolates smoothly on 60/120/144/165 Hz render cadence', () => {
  const fixedStep = 1 / 60;
  const speed = 240;
  for (const refresh of [60, 120, 144, 165]) {
    const motion = new TestDriveMotion({ x: 0, y: 0, angle: 0 });
    let accumulator = 0;
    let physicsX = 0;
    let lastRenderedX = 0;
    for (let frame = 0; frame < refresh * 2; frame++) {
      accumulator += 1 / refresh;
      while (accumulator + 1e-12 >= fixedStep) {
        physicsX += speed * fixedStep;
        motion.step({ x: physicsX, y: 0, angle: 0 });
        accumulator -= fixedStep;
      }
      const rendered = motion.sample(accumulator / fixedStep);
      const jump = rendered.x - lastRenderedX;
      assert.ok(jump >= -1e-8 && jump <= speed / refresh + 1e-6,
        `${refresh} Hz frame ${frame}: unexpected rendered jump ${jump}`);
      lastRenderedX = rendered.x;
    }
    assert.ok(Math.abs(lastRenderedX - (speed * 2 - speed * fixedStep)) < speed / refresh + 0.01);
  }
});
