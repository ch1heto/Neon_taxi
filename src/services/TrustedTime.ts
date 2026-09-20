const MINIMUM_TRUSTED_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAXIMUM_TRUSTED_TIMESTAMP = Date.UTC(2100, 0, 1);

export interface TrustedTimeSample {
  localTimestamp?: number;
  performanceTimestamp?: number | null;
}

let serverEpochMs: number | null = null;
let performanceBaselineMs: number | null = null;
let localFallbackOffsetMs = 0;

export function isValidServerTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= MINIMUM_TRUSTED_TIMESTAMP && value < MAXIMUM_TRUSTED_TIMESTAMP;
}

function readPerformanceTimestamp(): number | null {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') return null;
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function sampleLocalTimestamp(sample?: TrustedTimeSample): number {
  return typeof sample?.localTimestamp === 'number' && Number.isFinite(sample.localTimestamp)
    ? sample.localTimestamp
    : Date.now();
}

function samplePerformanceTimestamp(sample?: TrustedTimeSample): number | null {
  if (sample && 'performanceTimestamp' in sample) {
    return typeof sample.performanceTimestamp === 'number' && Number.isFinite(sample.performanceTimestamp)
      ? sample.performanceTimestamp
      : null;
  }
  return readPerformanceTimestamp();
}

/** Anchor Yandex server time to a monotonic browser clock; invalid values restore local fallback. */
export function setTrustedServerTime(serverTimestamp: unknown, sample?: TrustedTimeSample): boolean {
  const localTimestamp = sampleLocalTimestamp(sample);
  if (!isValidServerTimestamp(serverTimestamp)) {
    resetTrustedTime();
    return false;
  }

  const offset = serverTimestamp - localTimestamp;
  if (!Number.isFinite(offset)) {
    resetTrustedTime();
    return false;
  }
  serverEpochMs = serverTimestamp;
  performanceBaselineMs = samplePerformanceTimestamp(sample);
  localFallbackOffsetMs = offset;
  return true;
}

export function getTrustedTimestamp(sample?: TrustedTimeSample): number {
  const localTimestamp = sampleLocalTimestamp(sample);
  if (serverEpochMs !== null && performanceBaselineMs !== null) {
    const currentPerformanceMs = samplePerformanceTimestamp(sample);
    if (currentPerformanceMs !== null && currentPerformanceMs >= performanceBaselineMs) {
      const monotonicTimestamp = serverEpochMs + (currentPerformanceMs - performanceBaselineMs);
      if (Number.isFinite(monotonicTimestamp)) return monotonicTimestamp;
    }
  }
  const fallbackTimestamp = localTimestamp + localFallbackOffsetMs;
  return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : localTimestamp;
}

export function getTrustedNow(sample?: TrustedTimeSample): Date {
  return new Date(getTrustedTimestamp(sample));
}

/** Test and explicit fallback hook; production synchronization normally uses setTrustedServerTime. */
export function resetTrustedTime(): void {
  serverEpochMs = null;
  performanceBaselineMs = null;
  localFallbackOffsetMs = 0;
}
