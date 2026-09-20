/**
 * Neon Taxi - Cyberpunk 2D HTML5 Game
 * Main Application Component
 */

import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/HUD';
import { ShopModal } from './components/ShopModal';
import { OrderCompleteModal } from './components/OrderCompleteModal';
import { TestDrive } from './components/TestDrive';
import { YandexAPI, DEFAULT_SAVE_DATA } from './services/YandexAPI';
import { GameEngine } from './game/GameEngine';
import { PlayerSaveData, Order } from './types/game';
import { AudioEngine } from './game/AudioEngine';
import { TEST_DRIVE_CAR_SKINS } from './game/CarCatalog';
import { closestPointOnSegment } from './game/geometry';
import { DriverProfileModal } from './components/DriverProfileModal';
import { ShiftResultModal } from './components/ShiftResultModal';
import type { ShiftResult } from './game/ShiftSystem';
import { ContractsModal } from './components/ContractsModal';
import type { ContractPeriod } from './types/game';

const DEV_COMPONENTS_COMPILED = import.meta.env.DEV;
const DeveloperToolsButton = DEV_COMPONENTS_COMPILED
  ? lazy(() => import('./components/DeveloperToolsButton').then(module => ({ default: module.DeveloperToolsButton })))
  : null;
const SdkDebugPanel = DEV_COMPONENTS_COMPILED
  ? lazy(() => import('./components/SdkDebugPanel').then(module => ({ default: module.SdkDebugPanel })))
  : null;
const AdOverlay = DEV_COMPONENTS_COMPILED
  ? lazy(() => import('./components/AdOverlay').then(module => ({ default: module.AdOverlay })))
  : null;

export default function App() {
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [saveData, setSaveData] = useState<PlayerSaveData>(DEFAULT_SAVE_DATA);
  const [isLoaded, setIsLoaded] = useState(false);
  const developerToolsEnabled = DEV_COMPONENTS_COMPILED;

  // Состояния модальных окон
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [testDriveSkinId, setTestDriveSkinId] = useState<string | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isContractsOpen, setIsContractsOpen] = useState(false);
  const [shiftResult, setShiftResult] = useState<ShiftResult | null>(null);
  const [openGarageAfterShift, setOpenGarageAfterShift] = useState(false);
  const [orderModalData, setOrderModalData] = useState<{ isOpen: boolean; reward: number; order: Order | null }>({
    isOpen: false,
    reward: 0,
    order: null,
  });

  // Состояние Mock-рекламы
  const [adOverlayData, setAdOverlayData] = useState<{
    isOpen: boolean;
    type: 'rewarded' | 'interstitial';
    onRewarded?: () => void;
    onClose?: () => void;
    onError?: (err: unknown) => void;
  }>({
    isOpen: false,
    type: 'rewarded',
  });

  // Синхронизация ref с состоянием движка
  const handleEngineReady = (eng: GameEngine) => {
    engineRef.current = eng;
    eng.setPlatformPaused(YandexAPI.getInstance().isLifecyclePaused());
    setEngine(eng);
    if (import.meta.env.DEV) {
      const qaMode = new URLSearchParams(window.location.search).get('qa');
      if (qaMode === 'normal-order' || qaMode === 'express-order' || qaMode === 'active-order') {
        const order = eng.startShift();
        order.orderType = qaMode.startsWith('express') ? 'express' : 'normal';
        order.passengerType = qaMode.startsWith('express') ? 'RUSH' : 'NORMAL';
        if (qaMode.startsWith('express')) {
          order.status = 'in_transit';
          order.rideElapsed = order.targetTime * 1.24;
        }
      }
      if (qaMode === 'express-result' || qaMode === 'rush-early-result') {
        requestAnimationFrame(() => {
          if (engineRef.current !== eng) return;
          const order = eng.startShift();
          order.orderType = 'express';
          order.passengerType = 'RUSH';
          const pickup = eng.map.parkingZones.find(zone => zone.id === order.pickupZoneId)!;
          const destination = eng.map.parkingZones.find(zone => zone.id === order.destinationZoneId)!;
          const parked = (zone: typeof pickup) => ({ x: zone.x, y: zone.y, angle: zone.angle,
            vx: 0, vy: 0, length: eng.car.length, width: eng.car.width });
          for (let tick = 0; tick < 43 && order.status === 'pickup'; tick++) eng.orders.update(1 / 60, parked(pickup));
          order.rideElapsed = order.targetTime * (qaMode === 'rush-early-result' ? 0.55 : 1.23);
          for (let tick = 0; tick < 43 && order.status === 'in_transit'; tick++) eng.orders.update(1 / 60, parked(destination));
        });
      }
      if (qaMode === 'vip-collision-result') {
        requestAnimationFrame(() => {
          if (engineRef.current !== eng) return;
          const order = eng.startShift();
          order.passengerType = 'VIP';
          order.orderType = 'normal';
          order.status = 'in_transit';
          eng.orders.recordStrongCollision(0.8);
          const destination = eng.map.parkingZones.find(zone => zone.id === order.destinationZoneId)!;
          const parked = { x: destination.x, y: destination.y, angle: destination.angle,
            vx: 0, vy: 0, length: eng.car.length, width: eng.car.width };
          for (let tick = 0; tick < 43 && order.status === 'in_transit'; tick++) eng.orders.update(1 / 60, parked);
        });
      }
      if (qaMode === 'fuel-station') {
        requestAnimationFrame(() => {
          if (engineRef.current !== eng) return;
          const station = eng.map.fuelStations[0];
          eng.syncSaveData({ ...eng.saveData, fuel: 50 });
          eng.car.recoverAt(station.x, station.y, station.angle);
          eng.camX = station.x;
          eng.camY = station.y;
        });
      }
      if (qaMode === 'parking-assist') {
        const order = eng.startShift();
        window.setTimeout(() => {
          if (engineRef.current !== eng || order.status !== 'pickup') return;
          const zone = eng.map.parkingZones.find(candidate => candidate.id === order.pickupZoneId);
          const road = zone && eng.map.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId);
          if (!zone || !road) return;
          const roadCenter = closestPointOnSegment(
            zone,
            { x: road.x1, y: road.y1 },
            { x: road.x2, y: road.y2 },
          );
          const towardRoadX = roadCenter.x - zone.x;
          const towardRoadY = roadCenter.y - zone.y;
          const length = Math.hypot(towardRoadX, towardRoadY) || 1;
          eng.car.recoverAt(
            zone.x + towardRoadX / length * 92,
            zone.y + towardRoadY / length * 92,
            zone.angle + 0.55,
          );
          eng.camX = zone.x;
          eng.camY = zone.y;
        }, 2500);
      }
    }
    requestAnimationFrame(() => YandexAPI.getInstance().signalLoadingReady());
  };

  useEffect(() => {
    let alive = true;
    const yapi = YandexAPI.getInstance();
    const removeRecoveredDataListener = yapi.onRecoveredPlayerData(data => {
      if (!alive) return;
      const activeEngine = engineRef.current;
      // A late cloud reconnect must not refund fuel consumed since the latest
      // 25-second autosave. Important economy events are already saved eagerly.
      const recovered = activeEngine
        ? { ...data, fuel: Math.min(data.fuel, activeEngine.saveData.fuel) }
        : data;
      setSaveData(recovered);
      activeEngine?.syncSaveData(recovered);
      AudioEngine.getInstance().applySettings(recovered.settings);
    });

    // 2. Регистрация хуков паузы игрового процесса при показе рекламы (через engineRef)
    const removeGamePauseHooks = yapi.registerGamePauseHooks(
      () => {
        engineRef.current?.setPlatformPaused(true);
      },
      () => {
        engineRef.current?.setPlatformPaused(false);
      }
    );

    // 3. Инициализация SDK и загрузка данных
    const initApp = async () => {
      try {
        await yapi.init();
        const loadedData = await yapi.loadPlayerData();
        if (!alive) return;
        setSaveData(loadedData);

        // Применение настроек звука
        const audio = AudioEngine.getInstance();
        audio.applySettings(loadedData.settings);
      } catch (e) {
        if (alive) console.warn('[App] Ошибка во время инициализации, запуск с дефолтными данными:', e);
      } finally {
        if (alive) setIsLoaded(true);
      }
    };

    initApp();

    return () => {
      alive = false;
      removeRecoveredDataListener();
      removeGamePauseHooks();
    };
  }, []);

  useEffect(() => {
    const yapi = YandexAPI.getInstance();
    if (!import.meta.env.DEV) {
      yapi.registerMockAdTrigger(null);
      return;
    }
    yapi.registerMockAdTrigger((type, onRewarded, onClose, onError) => {
      setAdOverlayData({ isOpen: true, type, onRewarded, onClose, onError });
    });
    return () => yapi.registerMockAdTrigger(null);
  }, []);

  // Управление паузой при открытии модалок
  useEffect(() => {
    if (!engine) return;
    const anyModalOpen = isShopOpen || isDebugOpen || isProfileOpen || isContractsOpen || shiftResult !== null ||
      orderModalData.isOpen || adOverlayData.isOpen || testDriveSkinId !== null;
    engine.setPaused(anyModalOpen);
  }, [isShopOpen, isDebugOpen, isProfileOpen, isContractsOpen, shiftResult, orderModalData.isOpen, adOverlayData.isOpen, testDriveSkinId, engine]);

  const handleOpenContracts = () => {
    engine?.refreshContracts();
    setIsContractsOpen(true);
  };

  const handleClaimContract = (period: ContractPeriod, contractId: string) => {
    engine?.claimContractReward(period, contractId);
  };

  const handleOpenGarage = () => {
    if (engine?.orders.isShiftActive()) {
      const hasActiveOrder = Boolean(engine.orders.getCurrentOrder());
      const prompt = hasActiveOrder
        ? 'Текущий заказ будет отменён. Завершить смену и открыть гараж?'
        : 'Завершить текущую смену и открыть гараж?';
      if (!window.confirm(prompt)) return;
      const result = hasActiveOrder ? engine.cancelCurrentOrderAndEndShift() : engine.endShift();
      if (result) {
        setOpenGarageAfterShift(true);
        setShiftResult(result);
        return;
      }
    }
    setIsShopOpen(true);
  };

  const handleOrderCompletePrompt = (order: Order, reward: number) => {
    setOrderModalData({
      isOpen: true,
      reward,
      order,
    });
  };

  const handleClaimReward = () => {
    if (orderModalData.order) engine?.claimRewardedBonus(orderModalData.order.id);
  };

  const handleCloseOrderModal = () => {
    setOrderModalData({ isOpen: false, reward: 0, order: null });
    if (engine && engine.saveData.ordersCompleted % 4 === 0) engine.yandexApi.showInterstitial();
  };

  const handleEndShift = () => {
    const result = engine?.endShift() ?? null;
    if (result) {
      setOpenGarageAfterShift(false);
      setShiftResult(result);
    }
  };

  const handleDismissShiftResult = () => {
    setShiftResult(null);
    if (openGarageAfterShift) {
      setOpenGarageAfterShift(false);
      setIsShopOpen(true);
    }
  };

  const handleShiftResultPrimary = () => {
    setShiftResult(null);
    if (openGarageAfterShift) {
      setOpenGarageAfterShift(false);
      setIsShopOpen(true);
      return;
    }
    engine?.startShift();
  };

  const handleToggleSound = () => {
    const newSoundState = !saveData.settings.soundEnabled;
    AudioEngine.getInstance().setSfxEnabled(newSoundState);
    if (engine) engine.updateSettings({ soundEnabled: newSoundState });
    else {
      const updated = { ...saveData, settings: { ...saveData.settings, soundEnabled: newSoundState } };
      setSaveData(updated);
      void YandexAPI.getInstance().savePlayerData(YandexAPI.getInstance().prepareSaveData(updated));
    }
  };

  const handleToggleMusic = () => {
    const newMusicState = !saveData.settings.musicEnabled;
    AudioEngine.getInstance().setMusicEnabled(newMusicState);
    if (engine) engine.updateSettings({ musicEnabled: newMusicState });
    else {
      const updated = { ...saveData, settings: { ...saveData.settings, musicEnabled: newMusicState } };
      setSaveData(updated);
      void YandexAPI.getInstance().savePlayerData(YandexAPI.getInstance().prepareSaveData(updated));
    }
  };

  const handleSetAudioVolume = (key: 'masterVolume' | 'engineVolume' | 'musicVolume', rawValue: number) => {
    const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(1, rawValue)) : 0;
    const audio = AudioEngine.getInstance();
    if (key === 'masterVolume') audio.setMasterVolume(value);
    else if (key === 'engineVolume') audio.setEngineVolume(value);
    else audio.setMusicVolume(value);
    if (engine) engine.updateSettings({ [key]: value });
    else {
      const updated = { ...saveData, settings: { ...saveData.settings, [key]: value } };
      setSaveData(updated);
      void YandexAPI.getInstance().savePlayerData(YandexAPI.getInstance().prepareSaveData(updated));
    }
  };

  const testDriveSkin = TEST_DRIVE_CAR_SKINS.find(skin => skin.id === testDriveSkinId);

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#070a14] text-cyan-400 font-cyber p-4 text-center">
        <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mb-4" />
        <div className="text-2xl tracking-widest font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500">
          NEON TAXI
        </div>
        <div className="text-xs text-slate-400 mt-2">Инициализация Yandex Games SDK...</div>

      </div>
    );
  }

  return (
    <div id="neon-taxi-root" className="relative w-screen h-screen overflow-hidden bg-[#070a14]">
      {/* 1. Игровой Canvas */}
      <GameCanvas
        saveData={saveData}
        onEngineReady={handleEngineReady}
        onDataChange={setSaveData}
        onOrderCompletePrompt={handleOrderCompletePrompt}
      />

      {/* 2. Cyberpunk HUD */}
      {testDriveSkinId === null && <HUD
        engine={engine}
        saveData={saveData}
        onOpenShop={handleOpenGarage}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenContracts={handleOpenContracts}
        onEndShift={handleEndShift}
        developerControls={developerToolsEnabled && DeveloperToolsButton
          ? <Suspense fallback={null}><DeveloperToolsButton onOpen={() => setIsDebugOpen(true)} /></Suspense>
          : null}
        onToggleSound={handleToggleSound}
        onToggleMusic={handleToggleMusic}
        onSetAudioVolume={handleSetAudioVolume}
      />}

      {/* 3. Гараж и магазин улучшений */}
      <ShopModal
        isOpen={isShopOpen}
        onClose={() => setIsShopOpen(false)}
        onTestDrive={skin => { setIsShopOpen(false); setTestDriveSkinId(skin.id); }}
        engine={engine}
        saveData={saveData}
        showDeveloperTools={developerToolsEnabled}
      />

      {testDriveSkinId && testDriveSkin && <TestDrive
        skin={testDriveSkin}
        onExit={() => { setTestDriveSkinId(null); setIsShopOpen(true); }}
      />}

      {/* 4. Модальное окно завершения заказа с предложением x2 рекламы */}
      <OrderCompleteModal
        isOpen={orderModalData.isOpen}
        baseReward={orderModalData.reward}
        onClaim={handleClaimReward}
        order={orderModalData.order}
        onClose={handleCloseOrderModal}
      />

      <DriverProfileModal
        isOpen={isProfileOpen}
        saveData={saveData}
        onClose={() => setIsProfileOpen(false)}
      />

      <ContractsModal
        isOpen={isContractsOpen}
        saveData={saveData}
        onClose={() => setIsContractsOpen(false)}
        onClaim={handleClaimContract}
      />

      <ShiftResultModal
        result={shiftResult}
        onDismiss={handleDismissShiftResult}
        onPrimary={handleShiftResultPrimary}
        primaryLabel={openGarageAfterShift ? 'ОТКРЫТЬ ГАРАЖ' : 'НАЧАТЬ НОВУЮ СМЕНУ'}
      />

      {/* 5. Дебаггер Yandex SDK */}
      {developerToolsEnabled && SdkDebugPanel && <Suspense fallback={null}><SdkDebugPanel
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        engine={engine}
        saveData={saveData}
        onDataChange={setSaveData}
      /></Suspense>}

      {/* 6. Полноэкранная симуляция рекламы (для тестирования) */}
      {developerToolsEnabled && AdOverlay && <Suspense fallback={null}><AdOverlay
        isOpen={adOverlayData.isOpen}
        type={adOverlayData.type}
        onRewarded={adOverlayData.onRewarded}
        onClose={() => {
          adOverlayData.onClose?.();
          setAdOverlayData(prev => ({ ...prev, isOpen: false }));
        }}
        onError={() => {
          adOverlayData.onError?.(new Error('Mock ad network error'));
          setAdOverlayData(prev => ({ ...prev, isOpen: false }));
        }}
      /></Suspense>}
    </div>
  );
}
