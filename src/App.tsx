/**
 * Neon Taxi - Cyberpunk 2D HTML5 Game
 * Main Application Component
 */

import { useState, useEffect, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/HUD';
import { ShopModal } from './components/ShopModal';
import { OrderCompleteModal } from './components/OrderCompleteModal';
import { TestDrive } from './components/TestDrive';
import { AdOverlay } from './components/AdOverlay';
import { SdkDebugPanel } from './components/SdkDebugPanel';
import { YandexAPI, DEFAULT_SAVE_DATA } from './services/YandexAPI';
import { GameEngine } from './game/GameEngine';
import { PlayerSaveData, Order } from './types/game';
import { AudioEngine } from './game/AudioEngine';
import { CAR_SKINS } from './game/Skins';

export default function App() {
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [saveData, setSaveData] = useState<PlayerSaveData>(DEFAULT_SAVE_DATA);
  const [isLoaded, setIsLoaded] = useState(false);

  // Состояния модальных окон
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [testDriveSkinId, setTestDriveSkinId] = useState<string | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
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
    setEngine(eng);
    if (import.meta.env.DEV) {
      const qaMode = new URLSearchParams(window.location.search).get('qa');
      if (qaMode === 'normal-order' || qaMode === 'express-order' || qaMode === 'active-order') {
        const order = eng.startShift();
        order.orderType = qaMode.startsWith('express') ? 'express' : 'normal';
        if (qaMode.startsWith('express')) {
          order.status = 'in_transit';
          order.rideElapsed = order.targetTime * 1.24;
        }
      }
      if (qaMode === 'express-result') {
        requestAnimationFrame(() => {
          if (engineRef.current !== eng) return;
          const order = eng.startShift();
          order.orderType = 'express';
          const pickup = eng.map.parkingZones.find(zone => zone.id === order.pickupZoneId)!;
          const destination = eng.map.parkingZones.find(zone => zone.id === order.destinationZoneId)!;
          const parked = (zone: typeof pickup) => ({ x: zone.x, y: zone.y, angle: zone.angle,
            vx: 0, vy: 0, length: eng.car.length, width: eng.car.width });
          for (let tick = 0; tick < 43 && order.status === 'pickup'; tick++) eng.orders.update(1 / 60, parked(pickup));
          order.rideElapsed = order.targetTime * 1.23;
          for (let tick = 0; tick < 43 && order.status === 'in_transit'; tick++) eng.orders.update(1 / 60, parked(destination));
        });
      }
    }
    requestAnimationFrame(() => YandexAPI.getInstance().signalLoadingReady());
  };

  useEffect(() => {
    let alive = true;
    const yapi = YandexAPI.getInstance();

    // 1. Регистрация триггера для Mock-рекламы
    yapi.registerMockAdTrigger((type, onRewarded, onClose, onError) => {
      setAdOverlayData({
        isOpen: true,
        type,
        onRewarded,
        onClose,
        onError,
      });
    });

    // 2. Регистрация хуков паузы игрового процесса при показе рекламы (через engineRef)
    yapi.registerGamePauseHooks(
      () => {
        engineRef.current?.setPaused(true);
      },
      () => {
        engineRef.current?.setPaused(false);
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
        audio.setSfxEnabled(loadedData.settings.soundEnabled);
        audio.setMusicEnabled(loadedData.settings.musicEnabled);
      } catch (e) {
        if (alive) console.warn('[App] Ошибка во время инициализации, запуск с дефолтными данными:', e);
      } finally {
        if (alive) setIsLoaded(true);
      }
    };

    initApp();

    return () => { alive = false; };
  }, []);

  // Управление паузой при открытии модалок
  useEffect(() => {
    if (!engine) return;
    const anyModalOpen = isShopOpen || isDebugOpen || orderModalData.isOpen || adOverlayData.isOpen || testDriveSkinId !== null;
    engine.setPaused(anyModalOpen);
  }, [isShopOpen, isDebugOpen, orderModalData.isOpen, adOverlayData.isOpen, testDriveSkinId, engine]);

  const handleOpenGarage = () => {
    if (engine?.orders.getCurrentOrder() && !window.confirm('Отказаться от текущего заказа и закончить смену?')) return;
    if (engine?.orders.getCurrentOrder()) engine.refuseOrder();
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
    engine?.requestNextOrder();
    if (engine && engine.saveData.ordersCompleted % 4 === 0) engine.yandexApi.showInterstitial();
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
        onOpenDebug={() => setIsDebugOpen(true)}
        onToggleSound={handleToggleSound}
        onToggleMusic={handleToggleMusic}
      />}

      {/* 3. Гараж и магазин улучшений */}
      <ShopModal
        isOpen={isShopOpen}
        onClose={() => setIsShopOpen(false)}
        onTestDrive={skin => { setIsShopOpen(false); setTestDriveSkinId(skin.id); }}
        engine={engine}
        saveData={saveData}
      />

      {testDriveSkinId && <TestDrive
        skin={CAR_SKINS.find(skin => skin.id === testDriveSkinId)!}
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

      {/* 5. Дебаггер Yandex SDK */}
      <SdkDebugPanel
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        engine={engine}
        saveData={saveData}
        onDataChange={setSaveData}
      />

      {/* 6. Полноэкранная симуляция рекламы (для тестирования) */}
      <AdOverlay
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
      />
    </div>
  );
}
