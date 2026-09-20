import type {
  ContractPeriod,
  ContractPeriodState,
  ContractProgressItem,
  ContractSaveState,
  PassengerType,
  PlayerSaveData,
  ShiftRating,
} from '../types/game';
import { getTrustedNow } from '../services/TrustedTime';

export type ContractType =
  | 'completeOrders'
  | 'perfectRides'
  | 'vipRides'
  | 'rushSuccesses'
  | 'rideEarnings'
  | 'highRatingShifts'
  | 'cleanOrders'
  | 'completeShifts';

export interface ContractDefinition {
  readonly id: string;
  readonly period: ContractPeriod;
  readonly type: ContractType;
  readonly target: number;
  readonly title: string;
  readonly description: string;
  readonly rewardCoins: number;
  readonly rewardXp: number;
}

export type ContractProgressEvent =
  | {
      type: 'orderCompleted';
      earnings: number;
      perfectRide: boolean;
      passengerType: PassengerType;
      rushSuccess: boolean;
      strongCollisions: number;
    }
  | { type: 'shiftCompleted'; rating: ShiftRating; completedOrders: number };

function defineContract(definition: ContractDefinition): Readonly<ContractDefinition> {
  return Object.freeze({ ...definition });
}

export const CONTRACT_DEFINITIONS: readonly Readonly<ContractDefinition>[] = Object.freeze([
  defineContract({ id: 'daily-orders-5', period: 'daily', type: 'completeOrders', target: 5,
    title: 'Городской ритм', description: 'Выполнить 5 заказов', rewardCoins: 600, rewardXp: 120 }),
  defineContract({ id: 'daily-perfect-2', period: 'daily', type: 'perfectRides', target: 2,
    title: 'Идеальная подача', description: 'Совершить 2 идеальные поездки', rewardCoins: 500, rewardXp: 100 }),
  defineContract({ id: 'daily-vip-1', period: 'daily', type: 'vipRides', target: 1,
    title: 'Особый пассажир', description: 'Выполнить 1 VIP-поездку', rewardCoins: 450, rewardXp: 90 }),
  defineContract({ id: 'daily-rush-2', period: 'daily', type: 'rushSuccesses', target: 2,
    title: 'Точно в срок', description: 'Успешно выполнить 2 RUSH-заказа', rewardCoins: 550, rewardXp: 110 }),
  defineContract({ id: 'daily-earnings-2500', period: 'daily', type: 'rideEarnings', target: 2500,
    title: 'Касса смены', description: 'Заработать 2 500 $ на заказах', rewardCoins: 700, rewardXp: 120 }),
  defineContract({ id: 'daily-rating-1', period: 'daily', type: 'highRatingShifts', target: 1,
    title: 'Высший класс', description: 'Завершить смену с рейтингом A или S', rewardCoins: 650, rewardXp: 130 }),
  defineContract({ id: 'daily-clean-2', period: 'daily', type: 'cleanOrders', target: 2,
    title: 'Чистая работа', description: 'Завершить 2 заказа без сильных столкновений', rewardCoins: 500, rewardXp: 100 }),
  defineContract({ id: 'weekly-orders-30', period: 'weekly', type: 'completeOrders', target: 30,
    title: 'Рабочая неделя', description: 'Выполнить 30 заказов', rewardCoins: 3500, rewardXp: 600 }),
  defineContract({ id: 'weekly-perfect-10', period: 'weekly', type: 'perfectRides', target: 10,
    title: 'Безупречный сервис', description: 'Совершить 10 идеальных поездок', rewardCoins: 3000, rewardXp: 500 }),
  defineContract({ id: 'weekly-vip-6', period: 'weekly', type: 'vipRides', target: 6,
    title: 'VIP-неделя', description: 'Выполнить 6 VIP-поездок', rewardCoins: 2500, rewardXp: 450 }),
  defineContract({ id: 'weekly-rush-8', period: 'weekly', type: 'rushSuccesses', target: 8,
    title: 'Срочная линия', description: 'Успешно выполнить 8 RUSH-заказов', rewardCoins: 2800, rewardXp: 500 }),
  defineContract({ id: 'weekly-earnings-20000', period: 'weekly', type: 'rideEarnings', target: 20000,
    title: 'Большая касса', description: 'Заработать 20 000 $ на заказах', rewardCoins: 4000, rewardXp: 650 }),
  defineContract({ id: 'weekly-rating-3', period: 'weekly', type: 'highRatingShifts', target: 3,
    title: 'Профессионал', description: 'Завершить 3 смены с рейтингом A или S', rewardCoins: 3500, rewardXp: 600 }),
  defineContract({ id: 'weekly-shifts-8', period: 'weekly', type: 'completeShifts', target: 8,
    title: 'Полная неделя', description: 'Завершить 8 смен', rewardCoins: 3200, rewardXp: 550 }),
]);

const DEFINITIONS_BY_ID = new Map(CONTRACT_DEFINITIONS.map(definition => [definition.id, definition]));
const CONTRACT_COUNT: Readonly<Record<ContractPeriod, number>> = Object.freeze({ daily: 3, weekly: 4 });

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function getDailyPeriodKey(date = getTrustedNow()): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function getWeeklyPeriodKey(date = getTrustedNow()): string {
  const calendarDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDay = calendarDay.getUTCDay() || 7;
  calendarDay.setUTCDate(calendarDay.getUTCDate() + 4 - isoDay);
  const isoYear = calendarDay.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil((((calendarDay.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${isoYear}-W${pad(isoWeek)}`;
}

export function getContractPeriodKey(period: ContractPeriod, date = getTrustedNow()): string {
  return period === 'daily' ? getDailyPeriodKey(date) : getWeeklyPeriodKey(date);
}

function seededValue(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function selectContractDefinitions(
  period: ContractPeriod,
  periodKey: string,
): readonly Readonly<ContractDefinition>[] {
  const candidates = CONTRACT_DEFINITIONS.filter(definition => definition.period === period);
  return candidates
    .map(definition => ({ definition, rank: seededValue(`${period}:${periodKey}:${definition.id}`) }))
    .sort((left, right) => left.rank - right.rank || left.definition.id.localeCompare(right.definition.id))
    .slice(0, CONTRACT_COUNT[period])
    .map(candidate => candidate.definition);
}

function createItem(definition: Readonly<ContractDefinition>): ContractProgressItem {
  return {
    contractId: definition.id,
    progress: 0,
    target: definition.target,
    completed: false,
    claimed: false,
  };
}

export function createContractPeriodState(period: ContractPeriod, periodKey: string): ContractPeriodState {
  return {
    periodKey,
    items: selectContractDefinitions(period, periodKey).map(createItem),
  };
}

export function createDefaultContractsState(date = getTrustedNow()): ContractSaveState {
  return {
    daily: createContractPeriodState('daily', getDailyPeriodKey(date)),
    weekly: createContractPeriodState('weekly', getWeeklyPeriodKey(date)),
  };
}

function sanitizeProgress(value: unknown, target: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(target, Math.floor(value)));
}

function sanitizePeriodState(
  value: unknown,
  period: ContractPeriod,
  currentKey: string,
): ContractPeriodState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createContractPeriodState(period, currentKey);
  }
  const source = value as Partial<ContractPeriodState>;
  if (source.periodKey !== currentKey || !Array.isArray(source.items)) {
    return createContractPeriodState(period, currentKey);
  }

  const selected = selectContractDefinitions(period, currentKey);
  const sourceById = new Map<string, unknown>();
  for (const rawItem of source.items) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const id = (rawItem as Partial<ContractProgressItem>).contractId;
    if (typeof id === 'string' && !sourceById.has(id)) sourceById.set(id, rawItem);
  }

  return {
    periodKey: currentKey,
    items: selected.map(definition => {
      const raw = sourceById.get(definition.id) as Partial<ContractProgressItem> | undefined;
      const progress = sanitizeProgress(raw?.progress, definition.target);
      const completed = progress >= definition.target;
      return {
        contractId: definition.id,
        progress,
        target: definition.target,
        completed,
        claimed: completed && raw?.claimed === true,
      };
    }),
  };
}

export function sanitizeContractsState(value: unknown, date = getTrustedNow()): ContractSaveState {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ContractSaveState>
    : {};
  return {
    daily: sanitizePeriodState(source.daily, 'daily', getDailyPeriodKey(date)),
    weekly: sanitizePeriodState(source.weekly, 'weekly', getWeeklyPeriodKey(date)),
  };
}

export function getContractDefinition(contractId: string): Readonly<ContractDefinition> | undefined {
  return DEFINITIONS_BY_ID.get(contractId);
}

function progressIncrement(definition: Readonly<ContractDefinition>, event: ContractProgressEvent): number {
  if (event.type === 'orderCompleted') {
    if (definition.type === 'completeOrders') return 1;
    if (definition.type === 'perfectRides') return event.perfectRide ? 1 : 0;
    if (definition.type === 'vipRides') return event.passengerType === 'VIP' ? 1 : 0;
    if (definition.type === 'rushSuccesses') return event.rushSuccess ? 1 : 0;
    if (definition.type === 'rideEarnings') {
      return Number.isFinite(event.earnings) ? Math.max(0, Math.floor(event.earnings)) : 0;
    }
    if (definition.type === 'cleanOrders') return event.strongCollisions === 0 ? 1 : 0;
    return 0;
  }
  const eligibleShift = Number.isFinite(event.completedOrders) && event.completedOrders >= 1;
  if (!eligibleShift) return 0;
  if (definition.type === 'highRatingShifts') return event.rating === 'A' || event.rating === 'S' ? 1 : 0;
  if (definition.type === 'completeShifts') return 1;
  return 0;
}

function progressPeriod(state: ContractPeriodState, event: ContractProgressEvent): ContractPeriodState {
  return {
    ...state,
    items: state.items.map(item => {
      if (item.completed) return { ...item };
      const definition = DEFINITIONS_BY_ID.get(item.contractId);
      if (!definition) return { ...item, progress: 0, completed: false, claimed: false };
      const progress = Math.min(definition.target, item.progress + progressIncrement(definition, event));
      return { ...item, progress, target: definition.target, completed: progress >= definition.target };
    }),
  };
}

export function recordContractProgress(
  saveData: PlayerSaveData,
  event: ContractProgressEvent,
  date = getTrustedNow(),
): PlayerSaveData {
  const contracts = sanitizeContractsState(saveData.contracts, date);
  return {
    ...saveData,
    contracts: {
      daily: progressPeriod(contracts.daily, event),
      weekly: progressPeriod(contracts.weekly, event),
    },
  };
}

export type ContractClaimResult =
  | { status: 'success'; saveData: PlayerSaveData }
  | { status: 'notFound' | 'incomplete' | 'alreadyClaimed'; saveData: PlayerSaveData };

export function claimContractReward(
  saveData: PlayerSaveData,
  period: ContractPeriod,
  contractId: string,
  date = getTrustedNow(),
): ContractClaimResult {
  const contracts = sanitizeContractsState(saveData.contracts, date);
  const item = contracts[period].items.find(candidate => candidate.contractId === contractId);
  if (!item) return { status: 'notFound', saveData: { ...saveData, contracts } };
  if (!item.completed) return { status: 'incomplete', saveData: { ...saveData, contracts } };
  if (item.claimed) return { status: 'alreadyClaimed', saveData: { ...saveData, contracts } };
  const definition = DEFINITIONS_BY_ID.get(contractId);
  if (!definition || definition.period !== period) {
    return { status: 'notFound', saveData: { ...saveData, contracts } };
  }

  const nextPeriod: ContractPeriodState = {
    ...contracts[period],
    items: contracts[period].items.map(candidate => candidate.contractId === contractId
      ? { ...candidate, claimed: true }
      : { ...candidate }),
  };
  const nextContracts = { ...contracts, [period]: nextPeriod };
  const coins = saveData.coins + definition.rewardCoins;
  return {
    status: 'success',
    saveData: {
      ...saveData,
      coins,
      highScore: Math.max(saveData.highScore, coins),
      driverXp: saveData.driverXp + definition.rewardXp,
      contracts: nextContracts,
    },
  };
}
