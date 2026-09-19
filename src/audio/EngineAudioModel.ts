export const LEGACY_ENGINE_BASE_GAIN = 0.0625;
export const LEGACY_ENGINE_BASE_FREQUENCY = 42;
export const LEGACY_ENGINE_FREQUENCY_SPAN = 65;
export const LEGACY_ENGINE_FILTER_BASE = 120;
export const LEGACY_ENGINE_FILTER_SPAN = 380;
export const CRUISE_VARIATION_LIMIT = 0.012;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

export interface EngineAudioState {
  acceleration: number;
  cruise: number;
  variation: number;
  gain: number;
  filterFrequency: number;
  mainFrequency: number;
  harmonicFrequency: number;
  harmonicGain: number;
  musicLoad: number;
}

/**
 * The original speed-to-pitch engine curve with one narrow cruise treatment.
 * update() mutates and returns one stable object so the frame loop allocates nothing.
 */
export class EngineAudioModel {
  public readonly state: EngineAudioState = {
    acceleration: 0,
    cruise: 0,
    variation: 0,
    gain: LEGACY_ENGINE_BASE_GAIN,
    filterFrequency: 140,
    mainFrequency: 45,
    harmonicFrequency: 90,
    harmonicGain: 1,
    musicLoad: 0,
  };

  private previousSpeed = 0;
  private previousThrottle = 0;
  private cruiseStableTime = 0;
  private variationTimer = 0;
  private variationTarget = 0;
  private randomSeed = 0x4e454f4e;

  public update(speedNormalized: number, throttleInput: number, braking: boolean, dtSeconds: number): EngineAudioState {
    const dt = Number.isFinite(dtSeconds) ? Math.max(1 / 240, Math.min(0.1, dtSeconds)) : 1 / 60;
    const speed = clamp01(speedNormalized);
    const throttle = clamp01(throttleInput);
    const rawAcceleration = (speed - this.previousSpeed) / dt;
    const throttleDelta = Math.abs(throttle - this.previousThrottle);
    this.previousSpeed = speed;
    this.previousThrottle = throttle;
    this.state.acceleration = approach(
      this.state.acceleration,
      Math.max(-2, Math.min(2, rawAcceleration)),
      7,
      dt,
    );

    const stableCruise = speed > 0.12 &&
      Math.abs(this.state.acceleration) < 0.035 &&
      throttleDelta < 0.05 &&
      !braking;
    this.cruiseStableTime = stableCruise ? this.cruiseStableTime + dt : 0;
    const cruiseTarget = this.cruiseStableTime >= 0.9 ? 1 : 0;
    this.state.cruise = approach(this.state.cruise, cruiseTarget, cruiseTarget ? 3.5 : 12, dt);

    if (this.state.cruise > 0.01) {
      this.variationTimer -= dt;
      if (this.variationTimer <= 0) {
        this.variationTarget = (this.nextRandom() * 2 - 1) * CRUISE_VARIATION_LIMIT;
        this.variationTimer = 0.5 + this.nextRandom();
      }
    } else {
      this.variationTarget = 0;
      this.variationTimer = 0;
    }
    this.state.variation = approach(
      this.state.variation,
      this.variationTarget,
      this.state.cruise > 0.01 ? 1.4 : 7,
      dt,
    );

    const legacyFrequency = LEGACY_ENGINE_BASE_FREQUENCY + speed * LEGACY_ENGINE_FREQUENCY_SPAN;
    const legacyFilter = LEGACY_ENGINE_FILTER_BASE + speed * LEGACY_ENGINE_FILTER_SPAN;
    const modulation = this.state.variation * this.state.cruise;
    this.state.mainFrequency = legacyFrequency * (1 + modulation);
    this.state.harmonicFrequency = this.state.mainFrequency * 2.01;
    this.state.gain = LEGACY_ENGINE_BASE_GAIN * (1 - this.state.cruise * 0.32);
    this.state.filterFrequency = legacyFilter * (1 - this.state.cruise * 0.16);
    this.state.harmonicGain = 1 - this.state.cruise * 0.28;
    this.state.musicLoad = clamp01(
      throttle * 0.25 + Math.max(0, this.state.acceleration) * 0.9 + throttleDelta * 0.5,
    );
    return this.state;
  }

  private nextRandom(): number {
    this.randomSeed = (Math.imul(this.randomSeed, 1664525) + 1013904223) >>> 0;
    return this.randomSeed / 0x100000000;
  }
}
