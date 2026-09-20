import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CONTRACT_DEFINITIONS,
  claimContractReward,
  createDefaultContractsState,
  getContractDefinition,
  getDailyPeriodKey,
  getWeeklyPeriodKey,
  recordContractProgress,
  sanitizeContractsState,
  selectContractDefinitions,
  type ContractType,
} from '../src/game/ContractSystem';
import { CAR_SKINS } from '../src/game/Skins';
import type { ContractPeriod, ContractProgressItem, PlayerSaveData } from '../src/types/game';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';
import { ContractsModal } from '../src/components/ContractsModal';

function saveAt(date: Date): PlayerSaveData {
  return {
    ...structuredClone(DEFAULT_SAVE_DATA),
    contracts: createDefaultContractsState(date),
  };
}

function itemByType(save: PlayerSaveData, period: ContractPeriod, type: ContractType): ContractProgressItem | undefined {
  return save.contracts[period].items.find(item => getContractDefinition(item.contractId)?.type === type);
}

test('daily selection is exactly three unique deterministic contracts and resets on a new day', () => {
  const date = new Date(2026, 0, 1, 12);
  const key = getDailyPeriodKey(date);
  const first = selectContractDefinitions('daily', key);
  const second = selectContractDefinitions('daily', key);
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map(definition => definition.id)).size, 3);
  assert.deepEqual(first.map(definition => definition.id), second.map(definition => definition.id));

  const progressed = saveAt(date);
  progressed.contracts.daily.items[0].progress = 1;
  const next = sanitizeContractsState(progressed.contracts, new Date(2026, 0, 2, 12));
  assert.equal(next.daily.periodKey, '2026-01-02');
  assert.ok(next.daily.items.every(item => item.progress === 0 && !item.completed && !item.claimed));
});

test('weekly selection is exactly four unique deterministic contracts with ISO week keys', () => {
  const date = new Date(2026, 0, 1, 12);
  const key = getWeeklyPeriodKey(date);
  assert.equal(key, '2026-W01');
  const first = selectContractDefinitions('weekly', key);
  const second = selectContractDefinitions('weekly', key);
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map(definition => definition.id)).size, 4);
  assert.deepEqual(first.map(definition => definition.id), second.map(definition => definition.id));
  assert.equal(getWeeklyPeriodKey(new Date(2027, 0, 1, 12)), '2026-W53');
});

test('one completed order progresses eligible daily and weekly counters exactly once', () => {
  const date = new Date(2026, 0, 1, 12);
  const before = saveAt(date);
  const after = recordContractProgress(before, {
    type: 'orderCompleted',
    earnings: 725,
    perfectRide: true,
    passengerType: 'VIP',
    rushSuccess: true,
    strongCollisions: 0,
  }, date);

  assert.equal(itemByType(after, 'daily', 'completeOrders')?.progress, 1);
  assert.equal(itemByType(after, 'daily', 'perfectRides')?.progress, 1);
  assert.equal(itemByType(after, 'daily', 'rideEarnings')?.progress, 725);
  assert.equal(itemByType(after, 'weekly', 'perfectRides')?.progress, 1);
  assert.equal(itemByType(after, 'weekly', 'rushSuccesses')?.progress, 1);
  assert.ok(before.contracts.daily.items.every(item => item.progress === 0), 'progress must be immutable');
});

test('VIP, RUSH, clean-order, earnings, completed-shift and A/S progress use gameplay facts', () => {
  const vipDate = new Date(2026, 0, 3, 12);
  const vip = recordContractProgress(saveAt(vipDate), {
    type: 'orderCompleted', earnings: 300, perfectRide: false, passengerType: 'VIP',
    rushSuccess: false, strongCollisions: 0,
  }, vipDate);
  assert.equal(itemByType(vip, 'daily', 'vipRides')?.progress, 1);
  assert.equal(itemByType(vip, 'daily', 'cleanOrders')?.progress, 1);

  const rushDate = new Date(2026, 0, 2, 12);
  const rush = recordContractProgress(saveAt(rushDate), {
    type: 'orderCompleted', earnings: 400, perfectRide: false, passengerType: 'RUSH',
    rushSuccess: true, strongCollisions: 1,
  }, rushDate);
  assert.equal(itemByType(rush, 'daily', 'rushSuccesses')?.progress, 1);
  assert.equal(itemByType(rush, 'daily', 'cleanOrders')?.progress, 0);

  const shift = recordContractProgress(rush, {
    type: 'shiftCompleted', rating: 'A', completedOrders: 1,
  }, rushDate);
  assert.equal(itemByType(shift, 'daily', 'highRatingShifts')?.progress, 1);
  assert.equal(itemByType(shift, 'weekly', 'completeShifts')?.progress, 1);
  assert.equal(itemByType(shift, 'weekly', 'highRatingShifts')?.progress, 1);
});

test('empty shifts do not progress completed-shift or A/S contracts', () => {
  const date = new Date(2026, 0, 2, 12);
  const before = saveAt(date);
  const empty = recordContractProgress(before, {
    type: 'shiftCompleted', rating: 'A', completedOrders: 0,
  }, date);
  assert.equal(itemByType(empty, 'weekly', 'completeShifts')?.progress, 0);
  assert.equal(itemByType(empty, 'daily', 'highRatingShifts')?.progress, 0);
  assert.equal(itemByType(empty, 'weekly', 'highRatingShifts')?.progress, 0);

  const real = recordContractProgress(before, {
    type: 'shiftCompleted', rating: 'A', completedOrders: 1,
  }, date);
  assert.equal(itemByType(real, 'weekly', 'completeShifts')?.progress, 1);
  assert.equal(itemByType(real, 'daily', 'highRatingShifts')?.progress, 1);
  assert.equal(itemByType(real, 'weekly', 'highRatingShifts')?.progress, 1);
  assert.ok(before.contracts.weekly.items.every(item => item.progress === 0), 'one event must be applied immutably once');
});

test('contract progress clamps at target and rejects negative or non-finite save values', () => {
  const date = new Date(2026, 0, 1, 12);
  const corrupt = createDefaultContractsState(date);
  corrupt.daily.items[0].progress = Number.NaN;
  corrupt.daily.items[1].progress = Number.POSITIVE_INFINITY;
  corrupt.daily.items[2].progress = -50;
  corrupt.weekly.items[0] = {
    contractId: 'unknown-contract', progress: 999, target: 1, completed: true, claimed: true,
  };
  const sanitized = sanitizeContractsState(corrupt, date);
  for (const state of [sanitized.daily, sanitized.weekly]) {
    for (const item of state.items) {
      assert.ok(Number.isFinite(item.progress));
      assert.ok(item.progress >= 0 && item.progress <= item.target);
      assert.ok(getContractDefinition(item.contractId));
    }
  }

  const save = saveAt(date);
  const earnings = itemByType(save, 'daily', 'rideEarnings')!;
  earnings.progress = earnings.target - 1;
  const progressed = recordContractProgress(save, {
    type: 'orderCompleted', earnings: 10_000, perfectRide: false, passengerType: 'NORMAL',
    rushSuccess: false, strongCollisions: 0,
  }, date);
  assert.equal(itemByType(progressed, 'daily', 'rideEarnings')?.progress, earnings.target);
  assert.equal(itemByType(progressed, 'daily', 'rideEarnings')?.completed, true);
});

test('claim is gated, adds coins and existing driver XP once, and remains claimed after reload', () => {
  const date = new Date(2026, 0, 1, 12);
  const base = saveAt(date);
  base.coins = 1000;
  base.driverXp = 250;
  const item = base.contracts.daily.items[0];
  const definition = getContractDefinition(item.contractId)!;

  assert.equal(claimContractReward(base, 'daily', item.contractId, date).status, 'incomplete');
  item.progress = item.target;
  item.completed = true;
  const claimed = claimContractReward(base, 'daily', item.contractId, date);
  assert.equal(claimed.status, 'success');
  assert.equal(claimed.saveData.coins, 1000 + definition.rewardCoins);
  assert.equal(claimed.saveData.driverXp, 250 + definition.rewardXp);
  assert.equal(claimed.saveData.totalEarnings, base.totalEarnings, 'rewards are not ride earnings');

  const duplicate = claimContractReward(claimed.saveData, 'daily', item.contractId, date);
  assert.equal(duplicate.status, 'alreadyClaimed');
  assert.equal(duplicate.saveData.coins, claimed.saveData.coins);
  assert.equal(duplicate.saveData.driverXp, claimed.saveData.driverXp);

  const reloaded = migrateSaveData(claimed.saveData, CAR_SKINS, date);
  const afterReload = claimContractReward(reloaded, 'daily', item.contractId, date);
  assert.equal(afterReload.status, 'alreadyClaimed');
  assert.equal(afterReload.saveData.coins, claimed.saveData.coins);
});

test('old saves receive safe contract defaults without losing progression or car upgrades', () => {
  const legacy = structuredClone(DEFAULT_SAVE_DATA) as Partial<PlayerSaveData>;
  delete legacy.contracts;
  legacy.coins = 9876;
  legacy.driverXp = 5432;
  legacy.ordersCompleted = 44;
  legacy.carUpgrades!.cruiser = { speedLevel: 3, handlingLevel: 4, dashLevel: 2 };
  const migrated = migrateSaveData(legacy, CAR_SKINS, new Date(2026, 4, 10, 12));
  assert.equal(migrated.coins, 9876);
  assert.equal(migrated.driverXp, 5432);
  assert.equal(migrated.ordersCompleted, 44);
  assert.deepEqual(migrated.carUpgrades.cruiser, { speedLevel: 3, handlingLevel: 4, dashLevel: 2 });
  assert.equal(migrated.contracts.daily.items.length, 3);
  assert.equal(migrated.contracts.weekly.items.length, 4);
});

test('contract economy values stay in the approved daily and weekly ranges', () => {
  for (const definition of CONTRACT_DEFINITIONS) {
    if (definition.period === 'daily') {
      assert.ok(definition.rewardCoins >= 400 && definition.rewardCoins <= 800);
      assert.ok(definition.rewardXp >= 80 && definition.rewardXp <= 150);
    } else {
      assert.ok(definition.rewardCoins >= 2500 && definition.rewardCoins <= 4500);
      assert.ok(definition.rewardXp >= 400 && definition.rewardXp <= 700);
    }
  }
});

test('contracts modal renders tabs, progress, rewards, reset info and claim state', () => {
  const date = new Date(2026, 0, 1, 12);
  const save = saveAt(date);
  const item = save.contracts.daily.items[0];
  item.progress = item.target;
  item.completed = true;
  const markup = renderToStaticMarkup(React.createElement(ContractsModal, {
    isOpen: true,
    saveData: save,
    onClose: () => {},
    onClaim: () => {},
  }));
  assert.match(markup, /id="contracts-modal"/);
  assert.match(markup, /ЕЖЕДНЕВНЫЕ/);
  assert.match(markup, /ЕЖЕНЕДЕЛЬНЫЕ/);
  assert.match(markup, /ПРОГРЕСС/);
  assert.match(markup, /ЗАБРАТЬ/);
  assert.match(markup, /обновятся завтра/);
  assert.match(markup, /XP/);
});
