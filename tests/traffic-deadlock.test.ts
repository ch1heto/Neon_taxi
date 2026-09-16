import assert from 'node:assert/strict';
import test from 'node:test';
import { CityMap } from '../src/game/CityMap';
import { vehicleCollisionCircles } from '../src/game/geometry';
import type { TrafficCar } from '../src/types/game';

function blockerCycles(cars: TrafficCar[]): string[][] {
  const byId = new Map(cars.map(car => [car.id, car]));
  const visited = new Set<string>();
  const cycles: string[][] = [];
  for (const car of cars) {
    if (visited.has(car.id)) continue;
    const chain: string[] = [];
    const position = new Map<string, number>();
    let current: TrafficCar | undefined = car;
    while (current && !visited.has(current.id)) {
      if (position.has(current.id)) {
        cycles.push(chain.slice(position.get(current.id)!));
        break;
      }
      position.set(current.id, chain.length);
      chain.push(current.id);
      current = current.blockingCarId ? byId.get(current.blockingCarId) : undefined;
    }
    for (const id of chain) visited.add(id);
  }
  return cycles;
}

test('a strict priority breaks reciprocal and three-NPC blocker cycles deterministically', () => {
  const map = new CityMap();
  const cars = map.trafficCars.slice(0, 3);
  map.trafficCars = cars;
  const internals = map as unknown as {
    compareTrafficPriority: (a: TrafficCar, b: TrafficCar) => number;
    resolveTrafficBlockerCycles: () => void;
  };
  for (const a of cars) for (const b of cars) {
    if (a === b) continue;
    assert.ok(internals.compareTrafficPriority(a, b) * internals.compareTrafficPriority(b, a) < 0);
  }
  for (const size of [2, 3]) {
    for (let index = 0; index < size; index++) {
      Object.assign(cars[index], { blockingReason: 'vehicleAhead',
        blockingCarId: cars[(index + 1) % size].id, speed: 100 });
    }
    const winner = cars.slice(0, size).reduce((best, car) =>
      internals.compareTrafficPriority(car, best) > 0 ? car : best);
    internals.resolveTrafficBlockerCycles();
    assert.deepEqual(blockerCycles(cars), []);
    assert.equal(winner.blockingCarId, null);
    assert.equal(winner.speed, 100);
    for (const loser of cars.slice(0, size).filter(car => car !== winner)) {
      assert.equal(loser.blockingCarId, winner.id);
      assert.equal(loser.speed, 0);
    }
    for (const car of cars) car.blockingCarId = null;
  }
});

test('NPC blocker graph stays acyclic, separated and progressing through a long traffic soak', () => {
  const seconds = Number(process.env.TRAFFIC_SOAK_SECONDS ?? 180);
  const map = new CityMap();
  const previous = new Map(map.trafficCars.map(car => [car.id, { x: car.x, y: car.y }]));
  const travelled = new Map(map.trafficCars.map(car => [car.id, 0]));
  let overlaps = 0;
  let cycles = 0;
  let reciprocalCycles = 0;
  let maxStopped = 0;
  let maxStep = 0;
  let firstCycle: string[] | null = null;

  for (let tick = 0; tick < seconds * 60; tick++) {
    map.update(1 / 60);
    let stopped = 0;
    for (const car of map.trafficCars) {
      const before = previous.get(car.id)!;
      const distance = Math.hypot(car.x - before.x, car.y - before.y);
      maxStep = Math.max(maxStep, distance);
      assert.ok(distance < 8, `${car.id} teleported at tick ${tick}`);
      assert.equal(map.isPointOnRoad(car.x, car.y, 3), true, `${car.id} left asphalt at tick ${tick}`);
      if (distance < 0.08) stopped++;
      travelled.set(car.id, travelled.get(car.id)! + distance);
      previous.set(car.id, { x: car.x, y: car.y });
    }
    maxStopped = Math.max(maxStopped, stopped);
    const found = blockerCycles(map.trafficCars);
    cycles += found.length;
    reciprocalCycles += found.filter(cycle => cycle.length === 2).length;
    firstCycle ??= found[0] ?? null;
    for (let a = 0; a < map.trafficCars.length; a++) {
      const first = map.trafficCars[a];
      const firstCircles = vehicleCollisionCircles(first);
      for (let b = a + 1; b < map.trafficCars.length; b++) {
        const second = map.trafficCars[b];
        if (Math.hypot(first.x - second.x, first.y - second.y) > 80) continue;
        for (const circle of firstCircles) {
          for (const other of vehicleCollisionCircles(second)) {
            if (Math.hypot(circle.x - other.x, circle.y - other.y) < circle.radius + other.radius - 1e-6) overlaps++;
          }
        }
      }
    }
  }

  const maxRecovery = Math.max(...map.trafficCars.map(car => car.recoveryCount));
  const minTravel = Math.min(...travelled.values());
  console.log(`traffic ${seconds}s: overlaps=${overlaps}, blocker cycles=${cycles}, ` +
    `A<->B=${reciprocalCycles}, max simultaneously stopped=${maxStopped}, ` +
    `max recoveryCount=${maxRecovery}, minimum distance travelled=${minTravel.toFixed(1)}, ` +
    `max step=${maxStep.toFixed(2)}, first cycle=${firstCycle?.join(' -> ') ?? 'none'}`);
  assert.equal(overlaps, 0);
  assert.equal(cycles, 0);
  assert.equal(reciprocalCycles, 0);
  assert.ok(maxRecovery <= 5, `recovery is still routine: ${maxRecovery}`);
  assert.ok(minTravel > seconds / 180 * 1200, `traffic did not progress: ${minTravel}`);
});
