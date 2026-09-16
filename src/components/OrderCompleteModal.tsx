import { useEffect, useRef, useState } from 'react';
import { Coins, Play, CheckCircle2, Sparkles } from 'lucide-react';
import type { Order } from '../types/game';
import { getExpressEfficiency } from '../game/OrderEconomy';
import { YandexAPI } from '../services/YandexAPI';
import { AudioEngine } from '../game/AudioEngine';

interface OrderCompleteModalProps {
  isOpen: boolean;
  baseReward: number;
  order: Order | null;
  onClaim: () => void;
  onClose: () => void;
}

export function OrderCompleteModal({
  isOpen,
  baseReward,
  order,
  onClaim,
  onClose,
}: OrderCompleteModalProps) {
  const [isAdLoading, setIsAdLoading] = useState(false);
  const adInProgress = useRef(false);
  const rewardClaimed = useRef(false);
  const closed = useRef(false);
  useEffect(() => {
    adInProgress.current = false;
    rewardClaimed.current = false;
    closed.current = false;
    setIsAdLoading(false);
  }, [order?.id]);

  if (!isOpen || !order) return null;

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  const handleWatchAd = () => {
    if (adInProgress.current || rewardClaimed.current) return;
    adInProgress.current = true;
    setIsAdLoading(true);
    const yapi = YandexAPI.getInstance();

    yapi.showRewardedVideo({
      onOpen: () => {
        console.log('[OrderModal] Реклама открыта.');
      },
      onRewarded: () => {
        if (rewardClaimed.current) return;
        rewardClaimed.current = true;
        console.log('[OrderModal] Вознаграждение подтверждено!');
        AudioEngine.getInstance().playCoinSound();
        onClaim();
      },
      onClose: () => {
        adInProgress.current = false;
        setIsAdLoading(false);
        finish();
      },
      onError: (err) => {
        console.warn('[OrderModal] Ошибка рекламы:', err);
        adInProgress.current = false;
        setIsAdLoading(false);
        finish();
      },
    });
  };

  const handleClaimStandard = () => {
    finish();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md font-sans">
      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-2xl text-center flex flex-col items-center text-slate-100">
        {/* Иконка успеха */}
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400 mb-3">
          <CheckCircle2 className="w-8 h-8" />
        </div>

        <h2 className="text-xl font-bold text-white tracking-tight">
          {order.orderType === 'express' ? 'ЭКСПРЕСС ВЫПОЛНЕН' : 'ЗАКАЗ ВЫПОЛНЕН'}
        </h2>
        <p className="text-xs text-slate-400 mt-1">Пассажир успешно доставлен по адресу</p>
        {order.orderType === 'express' && (
          <div className="text-sm text-amber-300 mt-3">
            Эффективность: {Math.round(getExpressEfficiency(order.rideElapsed, order.targetTime) * 100)}% · Время поездки: {order.rideElapsed.toFixed(1)} сек
          </div>
        )}

        {/* Награда */}
        <div className="flex items-center gap-2 px-5 py-2.5 my-4 rounded-xl bg-slate-800 border border-slate-700">
          <Coins className="w-5 h-5 text-amber-400" />
          <span className="text-2xl font-bold text-amber-300">
            +{baseReward} $
          </span>
        </div>

        {/* Главная кнопка: Смотреть рекламу за x2 */}
        <button
          id="btn-ad-x2"
          onClick={handleWatchAd}
          disabled={isAdLoading}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold shadow-md active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4 fill-slate-950" />
          <span>Получить ещё +100% (+{baseReward} $)</span>
          <Play className="w-3.5 h-3.5 fill-slate-950 ml-0.5" />
        </button>

        {/* Второстепенная кнопка: Обычная награда */}
        <button
          id="btn-claim-standard"
          onClick={handleClaimStandard}
          disabled={isAdLoading}
          className="mt-2.5 text-xs text-slate-400 hover:text-slate-200 py-2 px-4 rounded-lg transition-colors font-medium"
        >
          Продолжить · {baseReward} $ уже начислены
        </button>
      </div>
    </div>
  );
}
