import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CAR_CATALOG } from '../src/game/CarCatalog';
import { resolveGameLocale } from '../src/i18n/LocalizationService';
import {
  completeUnavailableInterstitial,
  completeUnavailableRewarded,
  YandexAPI,
} from '../src/services/YandexAPI';
import { getTrustedTimestamp, resetTrustedTime } from '../src/services/TrustedTime';

const expectedCars = Object.freeze({
  'mazda-rx7-fd': { name: 'Wazda MP-5', price: 4500, requiredOrders: 20 },
  'mercedes-amg': { name: 'Mercedep SLC', price: 7000, requiredOrders: 30 },
  'skyline-r34': { name: 'Missan Skylime HZR', price: 12000, requiredOrders: 48 },
  lamborghini: { name: 'Landorgini Suini', price: 18000, requiredOrders: 65 },
});

test('public car names and production prices change without changing stable ids', () => {
  for (const [id, expected] of Object.entries(expectedCars)) {
    const car = CAR_CATALOG.find(candidate => candidate.id === id);
    assert.ok(car);
    assert.equal(car.status, 'production');
    assert.deepEqual(
      { name: car.name, price: car.price, requiredOrders: car.requiredOrders },
      expected,
    );
    assert.equal(car.modelType, id);
  }
});

test('Yandex language resolution falls back safely while only Russian ships', () => {
  assert.equal(resolveGameLocale('ru'), 'ru');
  assert.equal(resolveGameLocale('ru-RU'), 'ru');
  assert.equal(resolveGameLocale('en'), 'ru');
  assert.equal(resolveGameLocale(undefined), 'ru');
});

test('unavailable production ads finish immediately and never grant a reward', () => {
  let interstitialShown: boolean | undefined;
  let rewarded = false;
  let rewardedError = false;
  completeUnavailableInterstitial({ onClose: shown => { interstitialShown = shown; } });
  completeUnavailableRewarded({
    onRewarded: () => { rewarded = true; },
    onError: () => { rewardedError = true; },
  });
  assert.equal(interstitialShown, false);
  assert.equal(rewarded, false);
  assert.equal(rewardedError, true);
});

test('YandexAPI unavailable production path neither pauses nor opens mock ads', () => {
  const api = new (YandexAPI as unknown as { new(): YandexAPI })();
  let pauses = 0;
  let resumes = 0;
  let interstitialShown: boolean | undefined;
  let rewarded = false;
  let rewardedError = false;
  api.registerGamePauseHooks(() => { pauses++; }, () => { resumes++; });

  api.showInterstitial({ onClose: shown => { interstitialShown = shown; } });
  api.showRewardedVideo({
    onRewarded: () => { rewarded = true; },
    onError: () => { rewardedError = true; },
  });

  assert.equal(interstitialShown, false);
  assert.equal(rewarded, false);
  assert.equal(rewardedError, true);
  assert.equal(pauses, 0);
  assert.equal(resumes, 0);
});

test('Yandex serverTime is consumed synchronously once and invalid values fall back locally', () => {
  const serverTimestamp = Date.UTC(2028, 2, 4, 5, 6, 7);
  const api = new (YandexAPI as unknown as { new(): YandexAPI })();
  let calls = 0;
  const internals = api as unknown as {
    ysdk: { serverTime: () => number };
    synchronizeServerTime: () => void;
  };
  try {
    internals.ysdk = { serverTime: () => { calls++; return serverTimestamp; } };
    internals.synchronizeServerTime();
    const trusted = getTrustedTimestamp();
    assert.equal(calls, 1);
    assert.ok(trusted >= serverTimestamp && trusted < serverTimestamp + 1_000);
    internals.synchronizeServerTime();
    assert.equal(calls, 1, 'serverTime must be cached after initialization');

    resetTrustedTime();
    const invalidApi = new (YandexAPI as unknown as { new(): YandexAPI })();
    const invalidInternals = invalidApi as unknown as {
      ysdk: { serverTime: () => number };
      synchronizeServerTime: () => void;
    };
    const localBefore = Date.now();
    invalidInternals.ysdk = { serverTime: () => Number.NaN };
    invalidInternals.synchronizeServerTime();
    assert.ok(getTrustedTimestamp() >= localBefore);
    assert.ok(getTrustedTimestamp() < localBefore + 1_000);
  } finally {
    resetTrustedTime();
  }
});

test('Yandex lifecycle events register once and aggregate pause reasons without double resume', () => {
  const api = new (YandexAPI as unknown as { new(): YandexAPI })();
  const handlers = new Map<string, () => void>();
  const registrations = new Map<string, number>();
  const internals = api as unknown as {
    ysdk: { on: (eventName: 'game_api_pause' | 'game_api_resume', callback: () => void) => void };
    registerSdkLifecycleEvents: () => void;
    notifyAdState: (isOpen: boolean, type: 'rewarded' | 'interstitial') => void;
  };
  internals.ysdk = {
    on: (eventName, callback) => {
      registrations.set(eventName, (registrations.get(eventName) ?? 0) + 1);
      handlers.set(eventName, callback);
    },
  };
  let pauses = 0;
  let resumes = 0;
  api.registerGamePauseHooks(() => { pauses++; }, () => { resumes++; });
  internals.registerSdkLifecycleEvents();
  internals.registerSdkLifecycleEvents();
  assert.equal(registrations.get('game_api_pause'), 1);
  assert.equal(registrations.get('game_api_resume'), 1);

  handlers.get('game_api_pause')!();
  handlers.get('game_api_pause')!();
  assert.equal(pauses, 1);
  internals.notifyAdState(true, 'interstitial');
  handlers.get('game_api_resume')!();
  assert.equal(resumes, 0, 'an open ad must keep the shared lifecycle paused');
  internals.notifyAdState(false, 'interstitial');
  internals.notifyAdState(false, 'interstitial');
  assert.equal(resumes, 1);

  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const engineSource = readFileSync(new URL('../src/game/GameEngine.ts', import.meta.url), 'utf8');
  assert.match(appSource, /setPlatformPaused\(true\)/);
  assert.match(appSource, /setPlatformPaused\(false\)/);
  assert.match(engineSource, /this\.uiPaused \|\| this\.visibilityPaused \|\| this\.platformPaused/);
});

test('context menu is disabled on the game canvas without a global contextmenu listener', () => {
  const canvasSource = readFileSync(new URL('../src/components/GameCanvas.tsx', import.meta.url), 'utf8');
  assert.match(canvasSource, /onContextMenu=\{event => event\.preventDefault\(\)\}/);
  assert.doesNotMatch(canvasSource, /document\.addEventListener\(['"]contextmenu/);
});

test('Google Fonts are absent and mock ads stay behind the DEV runtime guard', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const yandex = readFileSync(new URL('../src/services/YandexAPI.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(html + css, /fonts\.(?:googleapis|gstatic)\.com/i);
  assert.match(yandex, /this\.isMockMode && isDevelopmentRuntime\(\)/);
});
