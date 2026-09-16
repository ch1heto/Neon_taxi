import { useState } from 'react';
import { X, ShieldCheck, Database, Film, Coins, RefreshCw, Smartphone } from 'lucide-react';
import { YandexAPI } from '../services/YandexAPI';
import { PlayerSaveData } from '../types/game';
import { GameEngine } from '../game/GameEngine';

interface SdkDebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
  engine: GameEngine | null;
  saveData: PlayerSaveData;
  onDataChange: (data: PlayerSaveData) => void;
}

export function SdkDebugPanel({
  isOpen,
  onClose,
  engine,
  saveData,
  onDataChange,
}: SdkDebugPanelProps) {
  const [log, setLog] = useState<string[]>([]);
  const yapi = YandexAPI.getInstance();

  if (!isOpen) return null;

  const addLog = (msg: string) => {
    setLog(prev => [new Date().toLocaleTimeString() + ' ' + msg, ...prev.slice(0, 15)]);
  };

  const testInterstitial = () => {
    addLog('Запрос showInterstitial()...');
    yapi.showInterstitial({
      onOpen: () => addLog('[SDK] Interstitial onOpen'),
      onClose: (shown) => addLog(`[SDK] Interstitial onClose (shown: ${shown})`),
      onError: (err) => addLog(`[SDK] Interstitial onError: ${err}`),
    });
  };

  const testRewarded = () => {
    addLog('Запрос showRewardedVideo()...');
    yapi.showRewardedVideo({
      onOpen: () => addLog('[SDK] Rewarded onOpen'),
      onRewarded: () => {
        addLog('[SDK] Rewarded onRewarded: начислено 100 монет!');
        if (engine) {
          engine.addCoins(100);
          onDataChange({ ...saveData, coins: saveData.coins + 100 });
        }
      },
      onClose: () => addLog('[SDK] Rewarded onClose'),
      onError: (err) => addLog(`[SDK] Rewarded onError: ${err}`),
    });
  };

  const handleAddTestCoins = () => {
    if (engine) {
      engine.addCoins(500);
      onDataChange({ ...saveData, coins: saveData.coins + 500 });
      addLog('+500 монет добавлено в кошелек.');
    }
  };

  const handleResetSave = () => {
    if (window.confirm('Сбросить прогресс и очистить LocalStorage?')) {
      localStorage.removeItem('NEON_TAXI_SAVE_V1');
      window.location.reload();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-slate-950 border border-cyan-500/50 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Заголовок */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            <h2 className="font-cyber text-lg font-bold text-white">
              YANDEX GAMES SDK ДЕБАГГЕР
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl bg-slate-900 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Статус SDK */}
        <div className="my-3 p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs space-y-1.5 font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Режим SDK:</span>
            <span className={yapi.isMock() ? 'text-amber-400' : 'text-emerald-400 font-bold'}>
              {yapi.isMock() ? 'MOCK / Standalone' : 'PRODUCTION (YaGames)'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Тип устройства:</span>
            <span className="text-cyan-400 flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5" />
              {yapi.isMobile() ? 'Mobile / Touch' : 'Desktop (Клавиатура)'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Облачные сохранения:</span>
            <span className="text-purple-400">LocalStorage + player.setData</span>
          </div>
        </div>

        {/* Быстрые действия */}
        <div className="grid grid-cols-2 gap-2 my-2">
          <button
            onClick={testInterstitial}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-cyber text-xs flex items-center justify-center gap-1.5 active:scale-95"
          >
            <Film className="w-4 h-4 text-pink-400" />
            <span>Тест Interstitial</span>
          </button>
          <button
            onClick={testRewarded}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-cyber text-xs flex items-center justify-center gap-1.5 active:scale-95"
          >
            <Film className="w-4 h-4 text-amber-400" />
            <span>Тест Rewarded Video</span>
          </button>
          <button
            onClick={handleAddTestCoins}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-cyber text-xs flex items-center justify-center gap-1.5 active:scale-95"
          >
            <Coins className="w-4 h-4 text-amber-400" />
            <span>+500 Монет</span>
          </button>
          <button
            onClick={handleResetSave}
            className="p-2.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 font-cyber text-xs flex items-center justify-center gap-1.5 active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Сбросить данные</span>
          </button>
        </div>

        {/* Логи событий */}
        <div className="flex-1 overflow-y-auto mt-2 p-2.5 rounded-2xl bg-black border border-slate-800 font-mono text-[11px] text-slate-400 space-y-1">
          <div className="text-cyan-400 font-bold mb-1 flex items-center gap-1">
            <Database className="w-3.5 h-3.5" /> Журнал событий SDK:
          </div>
          {log.length === 0 ? (
            <div className="text-slate-600 italic">Нажмите кнопку выше для вызова рекламы или теста...</div>
          ) : (
            log.map((item, idx) => (
              <div key={idx} className="text-slate-300">{item}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
