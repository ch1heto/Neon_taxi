import { useState, useEffect } from 'react';
import { Film, CheckCircle, AlertTriangle, X } from 'lucide-react';

interface AdOverlayProps {
  isOpen: boolean;
  type: 'rewarded' | 'interstitial';
  onRewarded?: () => void;
  onClose: () => void;
  onError?: () => void;
}

export function AdOverlay({
  isOpen,
  type,
  onRewarded,
  onClose,
  onError,
}: AdOverlayProps) {
  const [countdown, setCountdown] = useState(3);
  const [canSkip, setCanSkip] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(3);
      setCanSkip(false);
      return;
    }

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setCanSkip(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSuccessReward = () => {
    onRewarded?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between p-6 bg-black/95 text-white backdrop-blur-xl">
      {/* Верхний статус бар */}
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 font-cyber text-xs">
          <Film className="w-4 h-4" />
          <span>YANDEX GAMES SDK • {type.toUpperCase()} AD (MOCK/ТЕСТ)</span>
        </div>

        {canSkip ? (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-xs font-cyber font-bold hover:bg-slate-700"
          >
            <X className="w-4 h-4" /> ПРОПУСТИТЬ
          </button>
        ) : (
          <div className="font-cyber text-xs text-slate-400">
            Пропуск через: <span className="text-white font-bold">{countdown}</span> сек
          </div>
        )}
      </div>

      {/* Центральное визуальное поле рекламы */}
      <div className="flex flex-col items-center justify-center text-center max-w-sm">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-pink-600 to-purple-600 flex items-center justify-center text-white mb-4 animate-pulse shadow-[0_0_30px_rgba(219,39,119,0.5)]">
          <Film className="w-10 h-10" />
        </div>
        <h3 className="font-cyber text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-cyan-400">
          СИМУЛЯТОР РЕКЛАМЫ ЯНДЕКС
        </h3>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          В реальном окружении Яндекс Игр здесь отображается полноэкранный видеоролик рекламодателя.
        </p>

        {/* Индикатор прогресса */}
        <div className="w-48 h-1.5 bg-slate-800 rounded-full mt-5 overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-1000"
            style={{ width: `${((3 - countdown) / 3) * 100}%` }}
          />
        </div>
      </div>

      {/* Панель ручного тестирования коллбэков SDK */}
      <div className="w-full max-w-md flex flex-col gap-2 p-3.5 rounded-2xl bg-slate-900 border border-slate-800">
        <span className="text-[11px] font-cyber text-slate-400 uppercase text-center">
          Тестирование сценариев SDK:
        </span>
        <div className="flex gap-2">
          {type === 'rewarded' && (
            <button
              onClick={handleSuccessReward}
              className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-cyber text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <CheckCircle className="w-4 h-4" /> Просмотр завершён
            </button>
          )}

          <button
            onClick={onClose}
            className="flex-1 py-2 px-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-cyber text-xs font-bold"
          >
            Закрыть
          </button>

          <button
            onClick={onError}
            className="py-2 px-3 rounded-xl bg-rose-950/60 border border-rose-600/40 text-rose-400 hover:bg-rose-900 font-cyber text-xs flex items-center justify-center"
            title="Имитировать ошибку сети"
          >
            <AlertTriangle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
