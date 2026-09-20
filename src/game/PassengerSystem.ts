import type { PassengerType } from '../types/game';

export interface PassengerDefinition {
  id: PassengerType;
  displayName: string;
  icon: string;
  description: string;
  conditionLabel: string;
  rewardModifier: number;
  xpModifier: number;
  probability: number;
  timed: boolean;
  targetTimeModifier: number;
  collisionQualityPenalty: number;
  dialogue: readonly string[];
}

export const LONG_DISTANCE_MIN_ROUTE_DISTANCE = 4_200;

export const PASSENGER_DEFINITIONS: Readonly<Record<PassengerType, PassengerDefinition>> = Object.freeze({
  NORMAL: {
    id: 'NORMAL', displayName: 'ОБЫЧНЫЙ', icon: '●',
    description: 'Обычная поездка по городу', conditionLabel: 'Без особых условий',
    rewardModifier: 1, xpModifier: 1, probability: 0.5, timed: false,
    targetTimeModifier: 1, collisionQualityPenalty: 2,
    dialogue: ['Поехали.', 'Спасибо, что приняли заказ.'],
  },
  RUSH: {
    id: 'RUSH', displayName: 'СПЕШИТ', icon: '⚡',
    description: 'Пассажир очень опаздывает', conditionLabel: 'Бонус за раннее прибытие',
    rewardModifier: 1.25, xpModifier: 1.2, probability: 0.18, timed: true,
    targetTimeModifier: 0.8, collisionQualityPenalty: 4,
    dialogue: ['Я очень опаздываю!', 'Можно побыстрее?'],
  },
  CAUTIOUS: {
    id: 'CAUTIOUS', displayName: 'ОСТОРОЖНЫЙ', icon: '◇',
    description: 'Предпочитает спокойную поездку', conditionLabel: 'Комфорт важнее скорости',
    rewardModifier: 1.18, xpModifier: 1.15, probability: 0.12, timed: false,
    targetTimeModifier: 1, collisionQualityPenalty: 14,
    dialogue: ['Пожалуйста, аккуратнее.', 'Я не люблю резкие манёвры.'],
  },
  VIP: {
    id: 'VIP', displayName: 'VIP', icon: '◆',
    description: 'Ценит комфорт и аккуратность', conditionLabel: '+45% за комфортную поездку',
    rewardModifier: 1.45, xpModifier: 1.4, probability: 0.1, timed: false,
    targetTimeModifier: 1, collisionQualityPenalty: 10,
    dialogue: ['Надеюсь на комфортную поездку.', 'Без спешки, главное аккуратно.'],
  },
  LONG_DISTANCE: {
    id: 'LONG_DISTANCE', displayName: 'ДАЛЬНИЙ', icon: '↗',
    description: 'Длинный маршрут через город', conditionLabel: 'Повышенная награда за дистанцию',
    rewardModifier: 1.35, xpModifier: 1.3, probability: 0.1, timed: false,
    targetTimeModifier: 1, collisionQualityPenalty: 3,
    dialogue: ['Ехать далековато.', 'Надеюсь, топлива хватит.'],
  },
});

export const PASSENGER_NAMES = Object.freeze([
  'Алекс', 'Анна', 'Макс', 'Вика', 'Денис', 'Лера',
  'Ник', 'Майя', 'Илья', 'Саша', 'Ева', 'Лео',
]);

export function selectPassengerType(randomValue = Math.random()): PassengerType {
  const roll = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999, randomValue)) : 0;
  let cumulative = 0;
  for (const definition of Object.values(PASSENGER_DEFINITIONS)) {
    cumulative += definition.probability;
    if (roll < cumulative) return definition.id;
  }
  return 'NORMAL';
}

export function getPassengerDefinition(type: PassengerType): PassengerDefinition {
  return PASSENGER_DEFINITIONS[type] ?? PASSENGER_DEFINITIONS.NORMAL;
}

export function getRideQualityRewardFactor(type: PassengerType, quality: number): number {
  const safeQuality = Math.max(0, Math.min(100, Number.isFinite(quality) ? quality : 0)) / 100;
  if (type === 'VIP') return 0.68 + safeQuality * 0.32;
  if (type === 'CAUTIOUS') return 0.75 + safeQuality * 0.25;
  return 1;
}

export function getCollisionQualityPenalty(type: PassengerType, intensity: number): number {
  if (!Number.isFinite(intensity) || intensity < 0.42) return 0;
  const definition = getPassengerDefinition(type);
  return definition.collisionQualityPenalty * (0.8 + Math.min(1, intensity) * 0.4);
}

export interface CautiousDrivingSample {
  speed: number;
  maxSpeed: number;
  brake: boolean;
  steer: number;
  previousSteer: number;
  dash: boolean;
}

/** Returns a mild 0..1 aggression signal; ordinary braking and steering stay at zero. */
export function getCautiousAggressionSeverity(sample: CautiousDrivingSample): number {
  const safeSpeed = Number.isFinite(sample.speed) ? Math.max(0, sample.speed) : 0;
  const safeMaxSpeed = Number.isFinite(sample.maxSpeed) && sample.maxSpeed > 0 ? sample.maxSpeed : 1;
  const speedRatio = Math.max(0, Math.min(1, safeSpeed / safeMaxSpeed));
  let severity = sample.dash ? 1 : 0;
  if (sample.brake && speedRatio >= 0.72) severity = Math.max(severity, 0.65);
  const steer = Number.isFinite(sample.steer) ? sample.steer : 0;
  const previousSteer = Number.isFinite(sample.previousSteer) ? sample.previousSteer : 0;
  if (Math.abs(steer - previousSteer) >= 1.5 && speedRatio >= 0.68) {
    severity = Math.max(severity, 0.55);
  }
  return severity;
}
