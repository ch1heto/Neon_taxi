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
  },
};

const LOCAL_STORAGE_KEY = 'NEON_TAXI_SAVE_V1';
const QA_STORAGE_KEY = 'NEON_TAXI_QA_SAVE';

function getLocalStorageKey(): string {
  return typeof import.meta.env !== 'undefined' && import.meta.env.DEV &&
    typeof window !== 'undefined' && new URLSearchParams(window.location?.search ?? '').has('qa')
    ? QA_STORAGE_KEY : LOCAL_STORAGE_KEY;
}

export function migrateSaveData(data: Partial<PlayerSaveData> | null | undefined): PlayerSaveData {
  const validSkinIds = new Set(CAR_SKINS.map(skin => skin.id));
  const source = data ?? {};
  const selectedSkinId = typeof source.selectedSkinId === 'string' && validSkinIds.has(source.selectedSkinId)
    ? source.selectedSkinId
    : 'cruiser';
  const unlockedSkinIds = Array.isArray(source.unlockedSkinIds)
    ? source.unlockedSkinIds.filter((id): id is string => typeof id === 'string' && validSkinIds.has(id))
    : [];
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
      ...DEFAULT_SAVE_DATA.stats,
      ...(source.stats ?? {}),
    },
    settings: {
      ...DEFAULT_SAVE_DATA.settings,
      ...(source.settings ?? {}),
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

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMsg)), ms)
    ),
  ]);
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
  private saveQueue: Promise<void> = Promise.resolve();
  private latestRevision = 0;
  private loadingReadySent = false;
  private gameReady = false;

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
  public registerMockAdTrigger(trigger: (type: 'rewarded' | 'interstitial', onRewarded?: () => void, onClose?: () => void, onError?: (err: unknown) => void) => void) {
    this.mockAdTrigger = trigger;
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
      if (typeof window !== 'undefined' && window.YaGames) {
        console.log('[YandexAPI] Попытка инициализации YaGames SDK (таймаут 1000мс)...');
        // Защита от вечного ожидания: если игра открыта вне домена yandex.net,
        // YaGames.init() ждет postMessage от хостового окна и никогда не резолвится.
        this.ysdk = await withTimeout(
          window.YaGames.init(),
          1000,
          'YaGames.init timed out (running outside Yandex Games iframe)'
        );
        this.isMockMode = false;

        // Попытка инициализировать игрока с таймаутом
        try {
          this.player = await withTimeout(
            this.ysdk.getPlayer({ scopes: false }),
            800,
            'getPlayer timed out'
          );
          console.log('[YandexAPI] Игрок авторизован:', this.player.getMode());
        } catch (playerErr) {
          console.warn('[YandexAPI] Игрок не авторизован (гостевой режим):', playerErr);
        }

        this.isInitialized = true;
        this.trySignalLoadingReady();
        console.log('[YandexAPI] SDK успешно инициализирован в боевом режиме.');
        return true;
      } else {
        throw new Error('YaGames script not available in window');
      }
    } catch (error) {
      console.warn('[YandexAPI] YaGames SDK недоступен, включен безопасный MOCK режим:', error);
      this.isMockMode = true;
      this.isInitialized = true;
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

  /**
   * Загрузка прогресса: сначала проверяем Cloud, при ошибке/госте — LocalStorage
   */
  public async loadPlayerData(): Promise<PlayerSaveData> {
    let cloudData: Partial<PlayerSaveData> | null = null;

    if (this.player) {
      try {
        const data = await withTimeout(
          this.player.getData(),
          800,
          'player.getData timed out'
        );
        if (data && Object.keys(data).length > 0) {
          cloudData = data as Partial<PlayerSaveData>;
          console.log('[YandexAPI] Данные успешно загружены из Yandex Cloud:', cloudData);
        }
      } catch (err) {
        console.warn('[YandexAPI] Ошибка загрузки данных из Cloud:', err);
      }
    }

    // Загрузка из LocalStorage
    let localData: Partial<PlayerSaveData> | null = null;
    try {
      const raw = localStorage.getItem(getLocalStorageKey());
      if (raw) {
        localData = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[YandexAPI] Ошибка чтения LocalStorage:', e);
    }

    const merged = selectNewestSave(localData, cloudData);
    this.latestRevision = merged.saveRevision;

    // Синхронизируем локальный сторадж с объединенными данными
    try {
      localStorage.setItem(getLocalStorageKey(), JSON.stringify(merged));
    } catch (e) {
      console.warn('[YandexAPI] Ошибка записи в LocalStorage:', e);
    }
    if (this.player && localData && (!cloudData || merged.saveRevision > (cloudData.saveRevision ?? 0) ||
      (merged.saveRevision === (cloudData.saveRevision ?? 0) && merged.updatedAt > (cloudData.updatedAt ?? 0)))) {
      const player = this.player;
      this.saveQueue = this.saveQueue.then(() => player.setData(merged as unknown as Record<string, unknown>, true))
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
    try {
      localStorage.setItem(getLocalStorageKey(), JSON.stringify(snapshot));
      localSaved = true;
    } catch (e) {
      console.error('[YandexAPI] Не удалось сохранить в LocalStorage:', e);
    }
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
    const queued = this.saveQueue.then(persist, persist);
    this.saveQueue = queued.catch(() => {});
    return queued;
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
