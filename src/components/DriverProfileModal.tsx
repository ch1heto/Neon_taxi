import { Award, BriefcaseBusiness, Coins, Star, X } from 'lucide-react';
import type { PlayerSaveData } from '../types/game';
import { getXpProgress, MAX_DRIVER_LEVEL } from '../game/DriverProgression';
import { scoreToRating } from '../game/ShiftSystem';

interface DriverProfileModalProps {
  isOpen: boolean;
  saveData: PlayerSaveData;
  onClose: () => void;
}

export function DriverProfileModal({ isOpen, saveData, onClose }: DriverProfileModalProps) {
  if (!isOpen) return null;
  const progress = getXpProgress(saveData.driverXp);
  const bestRating = saveData.totalShifts > 0 ? scoreToRating(saveData.bestShiftScore) : '—';
  const stats = [
    ['Заказов', saveData.ordersCompleted.toLocaleString()],
    ['Заработано', `${saveData.totalEarnings.toLocaleString()} $`],
    ['Идеальных поездок', saveData.perfectRides.toLocaleString()],
    ['VIP поездок', saveData.vipRidesCompleted.toLocaleString()],
    ['Смен завершено', saveData.totalShifts.toLocaleString()],
    ['Лучший рейтинг', bestRating],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md font-sans">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-cyan-400/40 bg-slate-950 text-slate-100 shadow-2xl shadow-cyan-950/60">
        <div className="relative border-b border-slate-800 bg-gradient-to-br from-cyan-500/15 via-slate-950 to-fuchsia-500/10 p-5">
          <button onClick={onClose} aria-label="Закрыть профиль" className="absolute right-4 top-4 rounded-xl bg-slate-900/80 p-2 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
          <div className="text-[10px] font-black tracking-[0.28em] text-cyan-300">DRIVER PROFILE</div>
          <div className="mt-3 flex items-end gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-400/10">
              <Award className="h-8 w-8 text-cyan-300" />
            </div>
            <div>
              <div className="text-3xl font-black tracking-tight">LEVEL {progress.level}</div>
              <div className="text-xs font-bold tracking-[0.18em] text-fuchsia-300">{progress.rank}</div>
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-400">XP</span>
            <span className="text-cyan-200">
              {progress.level >= MAX_DRIVER_LEVEL ? `${progress.total.toLocaleString()} · MAX` : `${progress.current.toLocaleString()} / ${progress.required.toLocaleString()}`}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>Всего XP: {progress.total.toLocaleString()}</span>
            {progress.level < MAX_DRIVER_LEVEL && <span>До Level {progress.level + 1}: {(progress.required - progress.current).toLocaleString()} XP</span>}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {stats.map(([label, value], index) => (
              <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-500">
                  {index === 1 ? <Coins className="h-3 w-3" /> : index === 5 ? <Star className="h-3 w-3" /> : <BriefcaseBusiness className="h-3 w-3" />}
                  {label}
                </div>
                <div className="mt-1 text-base font-black text-slate-100">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
