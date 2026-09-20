import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { HUD } from '../src/components/HUD';
import { DeveloperToolsButton } from '../src/components/DeveloperToolsButton';
import { CityMap } from '../src/game/CityMap';
import { GAMEPLAY_AUTOSAVE_INTERVAL_SECONDS } from '../src/game/GameEngine';
import {
  getTrafficVehicleProfile,
  renderTrafficVehicle,
  TRAFFIC_VEHICLE_PROFILES,
  TRAFFIC_VEHICLE_TYPES,
} from '../src/game/TrafficVehicles';
import {
  DEFAULT_SAVE_DATA,
  migrateSaveData,
  SerializedSaveQueue,
  YANDEX_DATA_TIMEOUT_MS,
  YANDEX_PLAYER_TIMEOUT_MS,
  YANDEX_SDK_INIT_TIMEOUT_MS,
} from '../src/services/YandexAPI';

test('developer tools use only the Vite DEV guard and no Yandex identity allowlist', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const envSource = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const yandexSource = readFileSync(new URL('../src/services/YandexAPI.ts', import.meta.url), 'utf8');
  assert.match(appSource, /DEV_COMPONENTS_COMPILED = import\.meta\.env\.DEV/);
  assert.doesNotMatch(appSource + envSource + yandexSource, /ADMIN_PLAYER_IDS|VITE_ENABLE_ADMIN_TOOLS|VITE_LOCAL_DEV_ADMIN|getPlayerUniqueId/);
});

test('HUD omits the debug control unless privileged tools are authorized', () => {
  const baseProps = {
    engine: null,
    saveData: DEFAULT_SAVE_DATA,
    onOpenShop: () => {},
    onOpenProfile: () => {},
    onEndShift: () => {},
    onToggleSound: () => {},
    onToggleMusic: () => {},
    onSetAudioVolume: () => {},
  };
  const productionMarkup = renderToStaticMarkup(React.createElement(HUD, {
    ...baseProps,
    developerControls: null,
  }));
  const developerMarkup = renderToStaticMarkup(React.createElement(HUD, {
    ...baseProps,
    developerControls: React.createElement(DeveloperToolsButton, { onOpen: () => {} }),
  }));
  assert.doesNotMatch(productionMarkup, /hud-btn-debug/);
  assert.match(developerMarkup, /hud-btn-debug/);
  assert.match(productionMarkup, /Neon Drive/);
  assert.match(productionMarkup, /Neon Taxi/);
  assert.doesNotMatch(productionMarkup, /id="neon-fm-play"[^>]*disabled=""/);
});

test('save migration clamps every per-car upgrade level and repairs non-finite values', () => {
  const migrated = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    coins: Number.POSITIVE_INFINITY,
    highScore: Number.NaN,
    carUpgrades: {
      ...DEFAULT_SAVE_DATA.carUpgrades,
      cruiser: { speedLevel: -20, handlingLevel: 9.8, dashLevel: Number.NaN },
    },
  });
  assert.deepEqual(migrated.carUpgrades.cruiser, { speedLevel: 1, handlingLevel: 5, dashLevel: 1 });
  assert.equal(migrated.coins, DEFAULT_SAVE_DATA.coins);
  assert.equal(migrated.highScore, 0);
});

test('cloud save queue never overlaps requests, including after a rejection', async () => {
  const queue = new SerializedSaveQueue();
  let active = 0;
  let maxActive = 0;
  const order: number[] = [];
  const task = (id: number, reject = false) => queue.enqueue(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(id);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (reject) throw new Error('expected test failure');
  });
  const results = await Promise.allSettled([task(1), task(2, true), task(3)]);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('Yandex waits seconds with bounded recovery constants and gameplay autosaves every 25 seconds', () => {
  assert.ok(YANDEX_SDK_INIT_TIMEOUT_MS >= 5_000);
  assert.ok(YANDEX_PLAYER_TIMEOUT_MS >= 4_000);
  assert.ok(YANDEX_DATA_TIMEOUT_MS >= 4_000);
  assert.equal(GAMEPLAY_AUTOSAVE_INTERVAL_SECONDS, 25);
});

test('traffic spawns all eight weighted vehicle types with safe speed personalities', () => {
  assert.deepEqual(new Set(TRAFFIC_VEHICLE_TYPES), new Set([
    'compact', 'sedan', 'sport', 'luxury', 'suv', 'van', 'truck', 'taxi',
  ]));
  for (const profile of Object.values(TRAFFIC_VEHICLE_PROFILES)) {
    assert.ok(profile.speedModifier >= 0.88 && profile.speedModifier <= 1.10);
  }
  assert.equal(getTrafficVehicleProfile('truck').speedModifier, 0.91);
  assert.equal(getTrafficVehicleProfile('sport').speedModifier, 1.08);

  const map = new CityMap();
  const counts = new Map<string, number>();
  for (const car of map.trafficCars) {
    counts.set(car.modelType, (counts.get(car.modelType) ?? 0) + 1);
    assert.ok(car.targetSpeed >= 105 && car.targetSpeed <= 176, `${car.id} target speed is unsafe`);
  }
  for (const type of TRAFFIC_VEHICLE_TYPES) assert.ok((counts.get(type) ?? 0) > 0, `${type} never spawned`);
  assert.ok((counts.get('compact') ?? 0) > (counts.get('truck') ?? 0));
  assert.ok((counts.get('sedan') ?? 0) > (counts.get('sport') ?? 0));
});

test('every NPC silhouette renders through the lightweight Canvas path', () => {
  const noop = () => {};
  const shadowRects: number[][] = [];
  let shadowEllipseCount = 0;
  const context = {
    fillStyle: '',
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    lineWidth: 1,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    fill: noop,
    stroke: noop,
    fillRect(this: { fillStyle: string }, ...args: number[]) {
      if (this.fillStyle === 'rgba(0, 0, 0, 0.48)') shadowRects.push(args);
    },
    strokeRect: noop,
    roundRect: noop,
    ellipse() { shadowEllipseCount++; },
  } as unknown as CanvasRenderingContext2D;
  const map = new CityMap();
  for (const type of TRAFFIC_VEHICLE_TYPES) {
    const car = map.trafficCars.find(candidate => candidate.modelType === type);
    assert.ok(car, `missing ${type}`);
    assert.doesNotThrow(() => renderTrafficVehicle(context, car));
  }
  assert.equal(shadowRects.length, 0, 'NPC shadows must not use a body-sized rectangular fill');
  assert.equal(shadowEllipseCount, TRAFFIC_VEHICLE_TYPES.length, 'every NPC renderer needs a bounded soft shadow');
});
