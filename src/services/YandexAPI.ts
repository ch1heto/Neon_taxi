/**
 * Yandex Games SDK Integration Module
 * 
 * Предоставляет унифицированный интерфейс для взаимодействия с Yandex Games SDK v2:
 * - Инициализация (YaGames.init)
 * - Авторизация игрока и облачные сохранения (player.setData / getData)
 * - Синхронизация с LocalStorage при отсутствии сети или в гостевом режиме
 * - Показ Rewarded Video и Interstitial рекламы с паузой игрового процесса
 * - Локальный Mock-режим для бесшовного тестирования в браузере/Vite без SDK
 */

import { PlayerSaveData, AdCallbacks } from '../types/game';
import { CAR_SKINS } from '../game/Skins';
import { clampFuel, FUEL_CAPACITY } from '../game/FuelSystem';

// Объявление глобального объекта YaGames из CDN скрипта https://yandex.ru/games/sdk/v2
declare global {
  interface Window {
    YaGames?: {
      init: (options?: Record<string, unknown>) => Promise<YandexSDKInstance>;
    };
  }
}

export interface YandexSDKInstance {
  features?: { LoadingAPI?: { ready: () => void } };
  environment: {
    app: { id: string };
    browser: { lang: string };
    i18n: { lang: string; tld: string };
  };
  deviceInfo: {
    type: string;
    isMobile: () => boolean;
    isTablet: () => boolean;
    isDesktop: () => boolean;
  };
  getPlayer: (options?: { scopes?: boolean }) => Promise<YandexPlayerInstance>;
  adv: {
    showFullscreenAdv: (options?: {
      callbacks?: {
        onOpen?: () => void;
        onClose?: (wasShown: boolean) => void;
        onError?: (err: unknown) => void;
      };
    }) => void;
    showRewardedVideo: (options: {
      callbacks: {
        onOpen?: () => void;
        onRewarded?: () => void;
        onClose?: () => void;
        onError?: (err: unknown) => void;
      };
    }) => void;
  };
  isAvailableMethod: (methodName: string) => Promise<boolean>;
}

export interface YandexPlayerInstance {
  getMode: () => string; // 'lite' | ''
  getName: () => string;
  getPhoto: (size: string) => string;
  getUniqueID: () => string;
  setData: (data: Record<string, unknown>, flush?: boolean) => Promise<void>;
  getData: (keys?: string[]) => Promise<Record<string, unknown>>;
}

export const DEFAULT_SAVE_DATA: PlayerSaveData = {
  saveRevision: 0,
  updatedAt: 0,
  coins: 100,
  fuel: FUEL_CAPACITY,
  ordersCompleted: 0,
  highScore: 0,
  stats: {
    speedLevel: 1, // 1 to 5
    handlingLevel: 1, // 1 to 5
    dashLevel: 1, // 1 to 5
  },
  selectedSkinId: 'cruiser',
  unlockedSkinIds: ['cruiser'],
  settings: {
    soundEnabled: true,
    musicEnabled: true,
    masterVolume: 0.8,
    engineVolume: 0.8,
    musicVolume: 0.45,
  },
};

const LOCAL_STORAGE_KEY = 'NEON_TAXI_SAVE_V1';
const QA_STORAGE_KEY = 'NEON_TAXI_QA_SAVE';

function getLocalStorageKey(): string {
  return typeof import.meta.env !== 'undefined' && import.meta.env.DEV &&
    typeof window !== 'undefined' && new URLSearchParams(window.location?.search ?? '').has('qa')
    ? QA_STORAGE_KEY : LOCAL_STORAGE_KEY;
}

export function migrateSaveData(
  data: Partial<PlayerSaveData> | null | undefined,
  availableSkins = CAR_SKINS,
): PlayerSaveData {
  const validSkinIds = new Set(availableSkins.map(skin => skin.id));
  const source = data ?? {};
  const selectedSkinId = typeof source.selectedSkinId === 'string' && validSkinIds.has(source.selectedSkinId)
    ? source.selectedSkinId
    : 'cruiser';
  const unlockedSkinIds = Array.isArray(source.unlockedSkinIds)
    ? source.unlockedSkinIds.filter((id): id is string => typeof id === 'string' && validSkinIds.has(id))
    : [];
  const sourceStats: Partial<PlayerSaveData['stats']> = source.stats && typeof source.stats === 'object'
    ? source.stats : {};
  const sourceSettings: Partial<PlayerSaveData['settings']> = source.settings && typeof source.settings === 'object'
    ? source.settings : {};
  const clampUpgradeLevel = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(5, Math.floor(value)));
  };
  const clampVolume = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
  };
  if (!unlockedSkinIds.includes('cruiser')) unlockedSkinIds.unshift('cruiser');
  if (!unlockedSkinIds.includes(selectedSkinId)) unlockedSkinIds.push(selectedSkinId);
  return {
    ...DEFAULT_SAVE_DATA,
    ...source,
    coins: Number.isFinite(source.coins) ? Math.max(0, Number(source.coins)) : DEFAULT_SAVE_DATA.coins,
    fuel: source.fuel === undefined ? FUEL_CAPACITY : clampFuel(source.fuel),
    saveRevision: Number.isFinite(source.saveRevision) ? Math.max(0, Math.floor(Number(source.saveRevision))) : 0,
    updatedAt: Number.isFinite(source.updatedAt) ? Math.max(0, Number(source.updatedAt)) : 0,
    ordersCompleted: Number.isFinite(source.ordersCompleted ?? (source as { completedOrders?: number }).completedOrders)
      ? Math.max(0, Math.floor(Number(source.ordersCompleted ?? (source as { completedOrders?: number }).completedOrders)))
      : 0,
    highScore: Number.isFinite(source.highScore) ? Math.max(0, Number(source.highScore)) : 0,
    selectedSkinId,
    unlockedSkinIds: Array.from(new Set(unlockedSkinIds)),
    stats: {
      speedLevel: clampUpgradeLevel(sourceStats.speedLevel),
      handlingLevel: clampUpgradeLevel(sourceStats.handlingLevel),
      dashLevel: clampUpgradeLevel(sourceStats.dashLevel),
    },
    settings: {
      soundEnabled: typeof sourceSettings.soundEnabled === 'boolean'
        ? sourceSettings.soundEnabled : DEFAULT_SAVE_DATA.settings.soundEnabled,
      musicEnabled: typeof sourceSettings.musicEnabled === 'boolean'
        ? sourceSettings.musicEnabled : DEFAULT_SAVE_DATA.settings.musicEnabled,
      masterVolume: clampVolume(sourceSettings.masterVolume, DEFAULT_SAVE_DATA.settings.masterVolume),
      engineVolume: clampVolume(sourceSettings.engineVolume, DEFAULT_SAVE_DATA.settings.engineVolume),
      musicVolume: clampVolume(sourceSettings.musicVolume, DEFAULT_SAVE_DATA.settings.musicVolume),
    },
  };
}

export function selectNewestSave(localData: Partial<PlayerSaveData> | null, cloudData: Partial<PlayerSaveData> | null): PlayerSaveData {
  if (!localData && !cloudData) return migrateSaveData(null);
  if (!localData) return migrateSaveData(cloudData);
  if (!cloudData) return migrateSaveData(localData);
  const localRevision = Number.isFinite(localData.saveRevision) ? Number(localData.saveRevision) : 0;
  const cloudRevision = Number.isFinite(cloudData.saveRevision) ? Number(cloudData.saveRevision) : 0;
  if (localRevision !== cloudRevision) return migrateSaveData(localRevision > cloudRevision ? localData : cloudData);
  const localUpdatedAt = Number.isFinite(localData.updatedAt) ? Number(localData.updatedAt) : 0;
  const cloudUpdatedAt = Number.isFinite(cloudData.updatedAt) ? Number(cloudData.updatedAt) : 0;
  return migrateSaveData(cloudUpdatedAt > localUpdatedAt ? cloudData : localData);
}

export type AdStateListener = (isOpen: boolean, type: 'rewarded' | 'interstitial') => void;

export const YANDEX_SDK_INIT_TIMEOUT_MS = 6_000;
export const YANDEX_PLAYER_TIMEOUT_MS = 5_000;
export const YANDEX_DATA_TIMEOUT_MS = 5_000;
const INITIAL_RETRY_BACKOFF_MS = 750;
const BACKGROUND_RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000] as const;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMsg)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: { attempts: number; timeoutMs: number; backoffMs: number; label: string },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await withTimeout(operation(), options.timeoutMs, `${options.label} timed out`);
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) {
        await new Promise(resolve => setTimeout(resolve, options.backoffMs * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${options.label} failed`);
}

/** Serializes async persistence operations even when an earlier task rejects. */
export class SerializedSaveQueue {
  private tail: Promise<void> = Promise.resolve();

  public enqueue(task: () => Promise<void>): Promise<void> {
    const queued = this.tail.then(task, task);
    this.tail = queued.catch(() => {});
    return queued;
  }
}

export class YandexAPI {
  private static instance: YandexAPI;
  private ysdk: YandexSDKInstance | null = null;
  private player: YandexPlayerInstance | null = null;
  private isInitialized = false;
  private isMockMode = false;
  private adListeners: AdStateListener[] = [];
  private onPauseGameCallback: (() => void) | null = null;
  private onResumeGameCallback: (() => void) | null = null;
  private saveQueue = new SerializedSaveQueue();
  private latestRevision = 0;
  private loadingReadySent = false;
  private gameReady = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private connectionPromise: Promise<boolean> | null = null;
  private playerConnectionListeners: Array<(playerId: string | null) => void> = [];
  private recoveredDataListeners: Array<(data: PlayerSaveData) => void> = [];

  // Mock UI callback для визуализации рекламы в режиме тестирования
  private mockAdTrigger: ((type: 'rewarded' | 'interstitial', onRewarded?: () => void, onClose?: () => void, onError?: (err: unknown) => void) => void) | null = null;

  private constructor() {}

  public static getInstance(): YandexAPI {
    if (!YandexAPI.instance) {
      YandexAPI.instance = new YandexAPI();
    }
    return YandexAPI.instance;
  }

  /**
   * Регистрация хуков паузы игры для корректного глушения звуков и остановки физики
   */
  public registerGamePauseHooks(onPause: () => void, onResume: () => void) {
    this.onPauseGameCallback = onPause;
    this.onResumeGameCallback = onResume;
  }

  /**
   * Подписка на изменение состояния показа рекламы
   */
  public onAdStateChange(listener: AdStateListener): () => void {
    this.adListeners.push(listener);
    return () => {
      this.adListeners = this.adListeners.filter(l => l !== listener);
    };
  }

  private notifyAdState(isOpen: boolean, type: 'rewarded' | 'interstitial') {
    if (isOpen) {
      this.onPauseGameCallback?.();
    } else {
      this.onResumeGameCallback?.();
    }
    this.adListeners.forEach(listener => listener(isOpen, type));
  }

  /**
   * Регистрация обработчика Mock-рекламы для визуализации в Dev-режиме
   */
  public registerMockAdTrigger(trigger: ((type: 'rewarded' | 'interstitial', onRewarded?: () => void, onClose?: () => void, onError?: (err: unknown) => void) => void) | null) {
    this.mockAdTrigger = trigger;
  }

  public onPlayerConnectionChange(listener: (playerId: string | null) => void): () => void {
    this.playerConnectionListeners.push(listener);
    return () => {
      this.playerConnectionListeners = this.playerConnectionListeners.filter(candidate => candidate !== listener);
    };
  }

  public onRecoveredPlayerData(listener: (data: PlayerSaveData) => void): () => void {
    this.recoveredDataListeners.push(listener);
    return () => {
      this.recoveredDataListeners = this.recoveredDataListeners.filter(candidate => candidate !== listener);
    };
  }

  public getPlayerUniqueId(): string | null {
    if (!this.player) return null;
    try {
      const id = this.player.getUniqueID();
      return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
    } catch (error) {
      console.warn('[YandexAPI] Не удалось получить unique player ID:', error);
      return null;
    }
  }

  private notifyPlayerConnection(): void {
    const playerId = this.getPlayerUniqueId();
    this.playerConnectionListeners.forEach(listener => listener(playerId));
  }

  private async connectPlayer(attempts: number): Promise<boolean> {
    if (!this.ysdk) return false;
    try {
      this.player = await withRetry(
        () => this.ysdk!.getPlayer({ scopes: false }),
        { attempts, timeoutMs: YANDEX_PLAYER_TIMEOUT_MS, backoffMs: INITIAL_RETRY_BACKOFF_MS, label: 'getPlayer' },
      );
      console.log('[YandexAPI] Игрок авторизован:', this.player.getMode());
      this.notifyPlayerConnection();
      return true;
    } catch (error) {
      this.player = null;
      console.warn('[YandexAPI] Игрок пока недоступен, продолжаем в локальном режиме:', error);
      this.notifyPlayerConnection();
      return false;
    }
  }

  private async establishConnection(attempts: number): Promise<boolean> {
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = (async () => {
      if (typeof window === 'undefined' || !window.YaGames) return false;
      if (!this.ysdk) {
        this.ysdk = await withRetry(
          () => window.YaGames!.init(),
          { attempts, timeoutMs: YANDEX_SDK_INIT_TIMEOUT_MS, backoffMs: INITIAL_RETRY_BACKOFF_MS, label: 'YaGames.init' },
        );
      }
      this.isMockMode = false;
      this.trySignalLoadingReady();
      if (!this.player) await this.connectPlayer(attempts);
      return true;
    })().catch(error => {
      console.warn('[YandexAPI] SDK connection attempt failed:', error);
      return false;
    }).finally(() => {
      this.connectionPromise = null;
    });
    return this.connectionPromise;
  }

  private scheduleConnectionRecovery(): void {
    if (this.reconnectTimer !== null || this.reconnectAttempt >= BACKGROUND_RECONNECT_DELAYS_MS.length ||
        typeof window === 'undefined' || typeof window.setTimeout !== 'function') return;
    const delay = BACKGROUND_RECONNECT_DELAYS_MS[this.reconnectAttempt++];
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      const hadPlayer = Boolean(this.player);
      const sdkConnected = await this.establishConnection(1);
      if (sdkConnected && this.player && !hadPlayer) {
        await this.reconcileRecoveredCloudData();
      }
      if (!sdkConnected || !this.player) this.scheduleConnectionRecovery();
    }, delay);
  }

  /**
   * Инициализация Yandex Games SDK с безопасным фоллбеком на Mock
   */
  public async init(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (getLocalStorageKey() === QA_STORAGE_KEY) {
      this.isMockMode = true;
      this.isInitialized = true;
      return true;
    }

    try {
      if (await this.establishConnection(2)) {
        this.isInitialized = true;
        this.trySignalLoadingReady();
        console.log('[YandexAPI] SDK успешно инициализирован в боевом режиме.');
        if (!this.player) this.scheduleConnectionRecovery();
        return true;
      }
      throw new Error('YaGames script not available in window');
    } catch (error) {
      console.warn('[YandexAPI] YaGames SDK пока недоступен, включен локальный fallback:', error);
      this.isMockMode = true;
      this.isInitialized = true;
      this.scheduleConnectionRecovery();
      return true;
    }
  }

  public isMock(): boolean {
    return this.isMockMode;
  }

  public signalLoadingReady(): void {
    this.gameReady = true;
    this.trySignalLoadingReady();
  }

  private trySignalLoadingReady(): void {
    if (this.loadingReadySent || !this.gameReady || !this.ysdk) return;
    this.loadingReadySent = true;
    try { this.ysdk.features?.LoadingAPI?.ready(); }
    catch (error) { console.warn('[YandexAPI] LoadingAPI.ready failed:', error); }
  }

  public prepareSaveData(data: PlayerSaveData): PlayerSaveData {
    const snapshot = migrateSaveData(data);
    this.latestRevision = Math.max(this.latestRevision, snapshot.saveRevision) + 1;
    return { ...snapshot, saveRevision: this.latestRevision, updatedAt: Date.now() };
  }

  public isMobile(): boolean {
    if (this.ysdk?.deviceInfo) {
      return this.ysdk.deviceInfo.isMobile() || this.ysdk.deviceInfo.isTablet();
    }
    // Фолбек по userAgent и экрану
    return typeof window !== 'undefined' && (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768
    );
  }

  private async fetchCloudData(attempts: number): Promise<Partial<PlayerSaveData> | null> {
    if (!this.player) return null;
    try {
      const data = await withRetry(
        () => this.player!.getData(),
        { attempts, timeoutMs: YANDEX_DATA_TIMEOUT_MS, backoffMs: INITIAL_RETRY_BACKOFF_MS, label: 'player.getData' },
      );
      return data && Object.keys(data).length > 0 ? data as Partial<PlayerSaveData> : null;
    } catch (error) {
      console.warn('[YandexAPI] Ошибка загрузки данных из Cloud:', error);
      return null;
    }
  }

  private readLocalData(): Partial<PlayerSaveData> | null {
    try {
      const raw = localStorage.getItem(getLocalStorageKey());
      return raw ? JSON.parse(raw) as Partial<PlayerSaveData> : null;
    } catch (error) {
      console.warn('[YandexAPI] Ошибка чтения LocalStorage:', error);
      return null;
    }
  }

  private writeLocalData(data: PlayerSaveData): boolean {
    try {
      localStorage.setItem(getLocalStorageKey(), JSON.stringify(data));
      return true;
    } catch (error) {
      console.warn('[YandexAPI] Ошибка записи в LocalStorage:', error);
      return false;
    }
  }

  private async reconcileRecoveredCloudData(): Promise<void> {
    if (!this.player) return;
    const localData = this.readLocalData();
    const cloudData = await this.fetchCloudData(2);
    const merged = selectNewestSave(localData, cloudData);
    this.latestRevision = Math.max(this.latestRevision, merged.saveRevision);
    this.writeLocalData(merged);
    const cloudRevision = Number.isFinite(cloudData?.saveRevision) ? Number(cloudData?.saveRevision) : 0;
    const cloudUpdatedAt = Number.isFinite(cloudData?.updatedAt) ? Number(cloudData?.updatedAt) : 0;
    if (!cloudData || merged.saveRevision > cloudRevision ||
        (merged.saveRevision === cloudRevision && merged.updatedAt > cloudUpdatedAt)) {
      const player = this.player;
      await this.saveQueue.enqueue(() => player.setData(merged as unknown as Record<string, unknown>, true))
        .catch(error => console.warn('[YandexAPI] Recovered cloud sync failed:', error));
    }
    this.recoveredDataListeners.forEach(listener => listener(merged));
  }

  /**
   * Загрузка прогресса: сначала проверяем Cloud, при ошибке/госте — LocalStorage
   */
  public async loadPlayerData(): Promise<PlayerSaveData> {
    const cloudData = await this.fetchCloudData(2);
    if (cloudData) console.log('[YandexAPI] Данные успешно загружены из Yandex Cloud:', cloudData);
    const localData = this.readLocalData();

    const merged = selectNewestSave(localData, cloudData);
    this.latestRevision = merged.saveRevision;

    // Синхронизируем локальный сторадж с объединенными данными
    this.writeLocalData(merged);
    if (this.player && localData && (!cloudData || merged.saveRevision > (cloudData.saveRevision ?? 0) ||
      (merged.saveRevision === (cloudData.saveRevision ?? 0) && merged.updatedAt > (cloudData.updatedAt ?? 0)))) {
      const player = this.player;
      void this.saveQueue.enqueue(() => player.setData(merged as unknown as Record<string, unknown>, true))
        .catch(error => console.warn('[YandexAPI] Cloud sync failed:', error));
    }

    return merged;
  }

  /**
   * Сохранение прогресса игрока в LocalStorage и синхронизация с Yandex Cloud
   */
  public async savePlayerData(data: PlayerSaveData): Promise<void> {
    const snapshot = migrateSaveData(data);
    this.latestRevision = Math.max(this.latestRevision, snapshot.saveRevision);
    let localSaved = false;
    localSaved = this.writeLocalData(snapshot);
    const persist = async () => {
      let cloudSaved = false;
      if (this.player) {
        try {
          await this.player.setData(snapshot as unknown as Record<string, unknown>, true);
          cloudSaved = true;
        } catch (err) {
          console.warn('[YandexAPI] Ошибка отправки данных в облако:', err);
        }
      }
      if (!localSaved && !cloudSaved) throw new Error('Save failed in both local and cloud storage');
    };
    return this.saveQueue.enqueue(persist);
  }

  /**
   * Показ Rewarded Video рекламы
   */
  public showRewardedVideo(callbacks: AdCallbacks): void {
    this.notifyAdState(true, 'rewarded');

    if (this.isMockMode || !this.ysdk) {
      console.log('[YandexAPI:Mock] Запуск симуляции Rewarded Video...');
      callbacks.onOpen?.();

      if (this.mockAdTrigger) {
        // Запуск интерактивного модального окна просмотра
        this.mockAdTrigger('rewarded', () => {
          callbacks.onRewarded?.();
        }, () => {
          this.notifyAdState(false, 'rewarded');
          callbacks.onClose?.();
        }, error => {
          this.notifyAdState(false, 'rewarded');
          callbacks.onError?.(error);
        });
      } else {
        this.notifyAdState(false, 'rewarded');
        callbacks.onError?.(new Error('Mock rewarded UI unavailable'));
      }
      return;
    }

    // Боевой вызов через Yandex Games SDK v2
    try {
      this.ysdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => {
            console.log('[YandexSDK] Rewarded Video открыта.');
            callbacks.onOpen?.();
          },
          onRewarded: () => {
            console.log('[YandexSDK] Вознаграждение получено игроком.');
            callbacks.onRewarded?.();
          },
          onClose: () => {
            console.log('[YandexSDK] Rewarded Video закрыта.');
            this.notifyAdState(false, 'rewarded');
            callbacks.onClose?.();
          },
          onError: (error) => {
            console.error('[YandexSDK] Ошибка Rewarded Video:', error);
            this.notifyAdState(false, 'rewarded');
            callbacks.onError?.(error);
          },
        },
      });
    } catch (err) {
      console.error('[YandexSDK] Исключение при вызове showRewardedVideo:', err);
      this.notifyAdState(false, 'rewarded');
      callbacks.onError?.(err);
    }
  }

  /**
   * Показ Interstitial (полноэкранной) рекламы
   */
  public showInterstitial(callbacks?: { onOpen?: () => void; onClose?: (wasShown: boolean) => void; onError?: (err: unknown) => void }): void {
    this.notifyAdState(true, 'interstitial');

    if (this.isMockMode || !this.ysdk) {
      console.log('[YandexAPI:Mock] Запуск симуляции Interstitial Ad...');
      callbacks?.onOpen?.();

      if (this.mockAdTrigger) {
        this.mockAdTrigger('interstitial', undefined, () => {
          this.notifyAdState(false, 'interstitial');
          callbacks?.onClose?.(true);
        }, error => {
          this.notifyAdState(false, 'interstitial');
          callbacks?.onError?.(error);
        });
      } else {
        setTimeout(() => {
          this.notifyAdState(false, 'interstitial');
          callbacks?.onClose?.(true);
        }, 1200);
      }
      return;
    }

    try {
      this.ysdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => {
            console.log('[YandexSDK] Interstitial открыта.');
            callbacks?.onOpen?.();
          },
          onClose: (wasShown: boolean) => {
            console.log('[YandexSDK] Interstitial закрыта. Показана:', wasShown);
            this.notifyAdState(false, 'interstitial');
            callbacks?.onClose?.(wasShown);
          },
          onError: (error) => {
            console.error('[YandexSDK] Ошибка Interstitial:', error);
            this.notifyAdState(false, 'interstitial');
            callbacks?.onError?.(error);
          },
        },
      });
    } catch (err) {
      console.error('[YandexSDK] Исключение при вызове showFullscreenAdv:', err);
      this.notifyAdState(false, 'interstitial');
      callbacks?.onError?.(err);
    }
  }
}
