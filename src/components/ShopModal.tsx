import { useState } from 'react';
import { X, Gauge, Disc3, Zap, Car as CarIcon, Coins, Check, Shield, Lock } from 'lucide-react';
import { PlayerSaveData, CarSkin } from '../types/game';
import { CAR_SKINS, getUpgradeCost } from '../game/Skins';
import { GameEngine } from '../game/GameEngine';
import { AudioEngine } from '../game/AudioEngine';
import { CarPreviewCanvas } from './CarPreviewCanvas';
import { MAZDA_RX7_FD_TEST_DRIVE_SKIN } from '../game/ExperimentalCars';

interface ShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTestDrive: (skin: CarSkin) => void;
  engine: GameEngine | null;
  saveData: PlayerSaveData;
}

export function ShopModal({
  isOpen,
  onClose,
  onTestDrive,
  engine,
  saveData,
}: ShopModalProps) {
  const [activeTab, setActiveTab] = useState<'cars' | 'upgrades'>('cars');
  const [carFilter, setCarFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [isPurchasing, setIsPurchasing] = useState(false);

  // Предпросмотр выбранной машины (по умолчанию текущая выбранная)
  const [previewSkinId, setPreviewSkinId] = useState<string>(saveData.selectedSkinId || 'cruiser');

  if (!isOpen) return null;

  const currentPreviewSkin =
    CAR_SKINS.find(s => s.id === previewSkinId) ||
    CAR_SKINS.find(s => s.id === saveData.selectedSkinId) ||
    CAR_SKINS[0];

  const isPreviewUnlocked = saveData.unlockedSkinIds.includes(currentPreviewSkin.id);
  const isPreviewSelected = saveData.selectedSkinId === currentPreviewSkin.id;

  const handleUpgrade = (type: 'speed' | 'handling' | 'dash') => {
    if (!engine) return;
    const currentLevel =
      type === 'speed'
        ? saveData.stats.speedLevel
        : type === 'handling'
        ? saveData.stats.handlingLevel
        : saveData.stats.dashLevel;

    const cost = getUpgradeCost(type, currentLevel);
    if (cost === null || saveData.coins < cost) return;

    if (engine.purchaseUpgrade(type)) {
      AudioEngine.getInstance().playUpgradeSound();
    }
  };

  const handleSelectOrBuy = async (skin: CarSkin) => {
    if (!engine) return;
    const isUnlocked = saveData.unlockedSkinIds.includes(skin.id);
    setIsPurchasing(true);
    setPurchaseMessage('');
    const result = await engine.purchaseSkin(skin.id);
    setIsPurchasing(false);
    if (result.status === 'success' || result.status === 'alreadyOwned') {
      if (isUnlocked) AudioEngine.getInstance().playUiClick();
      else AudioEngine.getInstance().playUpgradeSound();
      setPurchaseMessage(result.status === 'success' ? 'Автомобиль куплен и выбран' : 'Автомобиль выбран');
    } else if (result.status === 'notEnoughCoins') {
      setPurchaseMessage(`Не хватает ${result.missingCoins} $`);
    } else if (result.status === 'notEnoughOrders') {
      setPurchaseMessage(`Требуется заказов: ${result.completed} / ${result.required}`);
    } else if (result.status === 'invalidSkin') {
      setPurchaseMessage('Неизвестная модель автомобиля');
    } else {
      setPurchaseMessage('Не удалось сохранить покупку. Монеты не списаны');
    }
  };

  const renderLevelDots = (level: number) => {
    return (
      <div className="flex gap-1.5 mt-1.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`w-5 h-1.5 rounded-full ${
              i <= level ? 'bg-cyan-400 shadow-sm shadow-cyan-400/50' : 'bg-slate-800'
            }`}
          />
        ))}
      </div>
    );
  };

  const filteredSkins = CAR_SKINS.filter(s => {
    const isUnlocked = saveData.unlockedSkinIds.includes(s.id);
    if (carFilter === 'unlocked') return isUnlocked;
    if (carFilter === 'locked') return !isUnlocked;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl p-4 sm:p-6 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100 font-sans">
        {/* Заголовок и баланс */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <CarIcon className="w-6 h-6 text-cyan-400" />
              Гараж и автосалон
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Выбор уникальных моделей такси и технические улучшения
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-300">
                {saveData.coins.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">$</span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Переключатель главных вкладок */}
        <div className="flex gap-2 my-3">
          <button
            onClick={() => setActiveTab('cars')}
            className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'cars'
                ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            <CarIcon className="w-4 h-4" />
            АВТОМОБИЛИ ({saveData.unlockedSkinIds.length}/{CAR_SKINS.length})
          </button>
          <button
            onClick={() => setActiveTab('upgrades')}
            className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'upgrades'
                ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            <Gauge className="w-4 h-4" />
            УЛУЧШЕНИЯ ХАРАКТЕРИСТИК
          </button>
        </div>

        {/* Содержимое вкладки: АВТОМОБИЛИ */}
        {activeTab === 'cars' && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-4">
            {/* 3.1 ИНТЕРАКТИВНЫЙ 3D ПОДИУМ ПРЕДПРОСМОТРА */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-1/2 shrink-0">
                <CarPreviewCanvas skin={currentPreviewSkin} />
              </div>

              <div className="w-full sm:w-1/2 flex flex-col justify-between h-full space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white tracking-wide">
                      {currentPreviewSkin.name}
                    </h3>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                      {currentPreviewSkin.modelType.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {currentPreviewSkin.description}
                  </p>
                </div>

                {/* Прогресс-бары характеристик */}
                <div className="space-y-2 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Скорость</span>
                      <span className="font-bold text-cyan-300">+{currentPreviewSkin.speedBonus} км/ч</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-cyan-400 h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, 45 + (currentPreviewSkin.speedBonus / 100) * 55)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Прочность</span>
                      <span className="font-bold text-amber-300">×{currentPreviewSkin.durability.toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div className="bg-amber-400 h-full rounded-full transition-all" style={{ width: `${Math.min(100, currentPreviewSkin.durability / 1.35 * 100)}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Управляемость</span>
                      <span className="font-bold text-emerald-300">+{Math.round(currentPreviewSkin.handlingBonus * 100)}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-400 h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, 50 + currentPreviewSkin.handlingBonus * 60)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Кнопка действия */}
                <div>
                  {purchaseMessage && (
                    <div className="mb-2 text-center text-[11px] font-semibold text-amber-300" role="status">
                      {purchaseMessage}
                    </div>
                  )}
                  {isPreviewSelected ? (
                    <div className="w-full py-2.5 px-4 rounded-xl bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs flex items-center justify-center gap-2">
                      <Check className="w-4 h-4" /> ТЕКУЩИЙ АВТОМОБИЛЬ
                    </div>
                  ) : isPreviewUnlocked ? (
                    <button
                      onClick={() => handleSelectOrBuy(currentPreviewSkin)}
                      className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-cyan-500/20"
                    >
                      ВЫБРАТЬ ЭТУ МОДЕЛЬ
                    </button>
                  ) : (
                    <button
                      disabled={isPurchasing || saveData.coins < currentPreviewSkin.price || saveData.ordersCompleted < currentPreviewSkin.requiredOrders}
                      onClick={() => handleSelectOrBuy(currentPreviewSkin)}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
                    >
                      {saveData.ordersCompleted < currentPreviewSkin.requiredOrders ? (
                        <span>ТРЕБУЕТСЯ ЗАКАЗОВ: {saveData.ordersCompleted} / {currentPreviewSkin.requiredOrders}</span>
                      ) : saveData.coins >= currentPreviewSkin.price ? (
                        <>
                          <span>КУПИТЬ ЗА {currentPreviewSkin.price}</span>
                          <Coins className="w-4 h-4" />
                        </>
                      ) : (
                        <span>НЕ ХВАТАЕТ {currentPreviewSkin.price - saveData.coins} $</span>
                      )}
                    </button>
                  )}
                  <button id="garage-test-drive" onClick={() => onTestDrive(currentPreviewSkin)} className="w-full mt-2 py-2.5 px-4 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-bold text-xs transition-colors shadow-lg shadow-violet-500/20">
                    ТЕСТ-ДРАЙВ · {currentPreviewSkin.name.toUpperCase()}
                  </button>
                </div>
              </div>
            </div>

            {/* Test-only vehicle: deliberately outside CAR_SKINS and every commerce/ownership path. */}
            <div id="experimental-mazda-rx7-fd" className="bg-rose-950/25 border border-rose-500/35 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-2/5 shrink-0">
                <CarPreviewCanvas skin={MAZDA_RX7_FD_TEST_DRIVE_SKIN} />
              </div>
              <div className="w-full sm:w-3/5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black tracking-widest px-2 py-1 rounded bg-rose-500 text-white">EXPERIMENTAL</span>
                  <span className="text-[10px] font-bold tracking-widest px-2 py-1 rounded bg-slate-800 text-rose-200 border border-rose-500/30">TEST VEHICLE</span>
                </div>
                <h3 className="mt-2 text-lg font-bold text-white">MAZDA RX-7 FD</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Отдельный тестовый профиль с временными уровнями Speed / Handling / Dash. Не продаётся, не выбирается для карьеры и не сохраняется.
                </p>
                <button
                  id="experimental-mazda-test-drive"
                  onClick={() => onTestDrive(MAZDA_RX7_FD_TEST_DRIVE_SKIN)}
                  className="w-full mt-3 py-2.5 px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs transition-colors shadow-lg shadow-rose-500/20"
                >
                  ТЕСТ-ДРАЙВ · MAZDA RX-7 FD
                </button>
              </div>
            </div>

            {/* Фильтры категорий */}
            <div className="flex gap-2">
              <button
                onClick={() => setCarFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  carFilter === 'all'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                Все модели ({CAR_SKINS.length})
              </button>
              <button
                onClick={() => setCarFilter('unlocked')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  carFilter === 'unlocked'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                Доступные ({saveData.unlockedSkinIds.length})
              </button>
              <button
                onClick={() => setCarFilter('locked')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  carFilter === 'locked'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                В автосалоне ({CAR_SKINS.length - saveData.unlockedSkinIds.length})
              </button>
            </div>

            {/* Список карточек для выбора */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pb-2">
              {filteredSkins.map(skin => {
                const isUnlocked = saveData.unlockedSkinIds.includes(skin.id);
                const isSelected = saveData.selectedSkinId === skin.id;
                const isCurrentPreview = previewSkinId === skin.id;

                return (
                  <div
                    key={skin.id}
                    onClick={() => setPreviewSkinId(skin.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-3 ${
                      isCurrentPreview
                        ? 'bg-slate-800 border-cyan-400 ring-1 ring-cyan-400/50'
                        : 'bg-slate-800/50 border-slate-700/70 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow border border-white/15"
                        style={{ backgroundColor: skin.primaryColor }}
                      >
                        <CarIcon className="w-5 h-5 text-slate-950" />
                      </div>

                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          {skin.name}
                          {isSelected && (
                            <span className="text-[10px] text-cyan-400 bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-800">
                              ВЫБРАН
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {isUnlocked ? (
                            <span className="text-emerald-400 font-medium">Куплено</span>
                          ) : (
                            <span className="text-amber-400 font-bold flex items-center gap-1">
                              <Lock className="w-3 h-3" /> {skin.price} $
                            </span>
                          )}
                        </div>
                        {!isUnlocked && skin.requiredOrders > 0 && (
                          <div className={`text-[10px] mt-0.5 ${saveData.ordersCompleted >= skin.requiredOrders ? 'text-emerald-400' : 'text-rose-300'}`}>
                            Заказов: {saveData.ordersCompleted} / {skin.requiredOrders}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      disabled={isPurchasing || (!isUnlocked && (saveData.coins < skin.price || saveData.ordersCompleted < skin.requiredOrders))}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewSkinId(skin.id);
                        handleSelectOrBuy(skin);
                      }}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-200"
                    >
                      {isSelected ? 'АКТИВЕН' : isUnlocked ? 'ВЫБРАТЬ' : 'КУПИТЬ'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Содержимое вкладки: УЛУЧШЕНИЯ ХАРАКТЕРИСТИК */}
        {activeTab === 'upgrades' && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            {/* Скорость */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/70">
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Gauge className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-sm font-bold text-slate-100">
                    Максимальная скорость
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Увеличивает предельный разгон и мощность двигателя
                  </p>
                  {renderLevelDots(saveData.stats.speedLevel)}
                </div>
              </div>

              {saveData.stats.speedLevel >= 5 ? (
                <span className="text-xs font-bold text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30">
                  МАКС. УРОВЕНЬ
                </span>
              ) : (
                <button
                  disabled={saveData.coins < (getUpgradeCost('speed', saveData.stats.speedLevel) ?? 0)}
                  onClick={() => handleUpgrade('speed')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-bold transition-all shadow"
                >
                  <span>{getUpgradeCost('speed', saveData.stats.speedLevel)}</span>
                  <Coins className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Управляемость */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/70">
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Disc3 className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-sm font-bold text-slate-100">
                    Сцепление и маневренность
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Уменьшает занос в крутых поворотах и улучшает контроль
                  </p>
                  {renderLevelDots(saveData.stats.handlingLevel)}
                </div>
              </div>

              {saveData.stats.handlingLevel >= 5 ? (
                <span className="text-xs font-bold text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30">
                  МАКС. УРОВЕНЬ
                </span>
              ) : (
                <button
                  disabled={saveData.coins < (getUpgradeCost('handling', saveData.stats.handlingLevel) ?? 0)}
                  onClick={() => handleUpgrade('handling')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-bold transition-all shadow"
                >
                  <span>{getUpgradeCost('handling', saveData.stats.handlingLevel)}</span>
                  <Coins className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Рывок Dash */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/70">
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-sm font-bold text-slate-100">
                    Перезарядка рывка Dash
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Сокращает время ожидания ускорения на [X]
                  </p>
                  {renderLevelDots(saveData.stats.dashLevel)}
                </div>
              </div>

              {saveData.stats.dashLevel >= 5 ? (
                <span className="text-xs font-bold text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30">
                  МАКС. УРОВЕНЬ
                </span>
              ) : (
                <button
                  disabled={saveData.coins < (getUpgradeCost('dash', saveData.stats.dashLevel) ?? 0)}
                  onClick={() => handleUpgrade('dash')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-bold transition-all shadow"
                >
                  <span>{getUpgradeCost('dash', saveData.stats.dashLevel)}</span>
                  <Coins className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
