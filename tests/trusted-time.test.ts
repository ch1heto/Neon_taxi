import assert from 'node:assert/strict';
import test from 'node:test';
import { getDailyPeriodKey, getWeeklyPeriodKey } from '../src/game/ContractSystem';
import {
  getTrustedNow,
  isValidServerTimestamp,
  resetTrustedTime,
  setTrustedServerTime,
} from '../src/services/TrustedTime';

test('valid server time drives daily and ISO-week contract keys through a cached offset', () => {
  const localNow = Date.UTC(2025, 5, 10, 9, 30);
  const serverNow = Date.UTC(2026, 0, 1, 23, 59);
  try {
    assert.equal(setTrustedServerTime(serverNow, {
      localTimestamp: localNow,
      performanceTimestamp: 500,
    }), true);
    const baseline = getTrustedNow({ localTimestamp: localNow, performanceTimestamp: 500 });
    assert.equal(baseline.getTime(), serverNow);
    assert.equal(getDailyPeriodKey(baseline), '2026-01-01');
    assert.equal(getWeeklyPeriodKey(baseline), '2026-W01');

    const afterMidnight = getTrustedNow({
      localTimestamp: localNow - 20 * 86_400_000,
      performanceTimestamp: 500 + 2 * 60_000,
    });
    assert.equal(getDailyPeriodKey(afterMidnight), '2026-01-02');
    assert.equal(afterMidnight.getTime(), serverNow + 2 * 60_000,
      'changing Date.now after baseline must not affect the monotonic trusted clock');
  } finally {
    resetTrustedTime();
  }
});

test('cached server offset crosses an ISO week without another server call', () => {
  const localNow = Date.UTC(2025, 7, 1, 12);
  const serverSunday = Date.UTC(2026, 0, 4, 23, 59);
  try {
    setTrustedServerTime(serverSunday, { localTimestamp: localNow, performanceTimestamp: 100 });
    assert.equal(getWeeklyPeriodKey(getTrustedNow({ localTimestamp: localNow, performanceTimestamp: 100 })), '2026-W01');
    assert.equal(getWeeklyPeriodKey(getTrustedNow({
      localTimestamp: localNow,
      performanceTimestamp: 100 + 2 * 60_000,
    })), '2026-W02');
  } finally {
    resetTrustedTime();
  }
});

test('unavailable or invalid server time safely falls back to local time', () => {
  const localNow = Date.UTC(2027, 6, 14, 8, 15);
  try {
    for (const invalid of [undefined, null, '2026-01-01', Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.equal(setTrustedServerTime(invalid, { localTimestamp: localNow, performanceTimestamp: 50 }), false);
      const fallback = getTrustedNow({ localTimestamp: localNow, performanceTimestamp: 60 });
      assert.equal(fallback.getTime(), localNow);
      assert.equal(getDailyPeriodKey(fallback), '2027-07-14');
    }
    assert.equal(isValidServerTimestamp(localNow), true);
  } finally {
    resetTrustedTime();
  }
});

test('daily and ISO-week keys always use UTC calendar fields', () => {
  const utcPreviousDay = new Date('2026-01-01T00:30:00+14:00');
  assert.equal(getDailyPeriodKey(utcPreviousDay), '2025-12-31');
  assert.equal(getWeeklyPeriodKey(utcPreviousDay), '2026-W01');

  const utcNextWeek = new Date('2027-01-03T23:30:00-02:00');
  assert.equal(getDailyPeriodKey(utcNextWeek), '2027-01-04');
  assert.equal(getWeeklyPeriodKey(utcNextWeek), '2027-W01');
});
