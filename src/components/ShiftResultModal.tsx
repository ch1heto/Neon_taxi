import { Award, Clock3, Coins, ShieldCheck, Star, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ShiftResult } from '../game/ShiftSystem';
import { getXpProgress } from '../game/DriverProgression';

interface ShiftResultModalProps {
  result: ShiftResult | null;
  onDismiss: () => void;
  onPrimary: () => void;
  primaryLabel: string;
}

export function ShiftResultModal({ result, onDismiss, onPrimary, primaryLabel }: ShiftResultModalProps) {
  if (!result) return null;
  const progress = getXpProgress(result.driverXpAfter);
  const minutes = Math.floor(result.durationSeconds / 60);
  const seconds = result.durationSeconds % 60;
  const levelUp = result.levelAfter > result.levelBefore;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md font-sans">
      <div className="relative w-full max-w-md overflow-y-auto rounded-3xl border border-cyan-400/40 bg-slate-950 p-5 text-slate-100 shadow-2xl max-h-[92vh]">
        <button onClick={onDismiss} aria-label="Закрыть результаты" className="absolute right-4 top-4 rounded-xl bg-slate-900 p-2 text-slate-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
        <div className="text-[10px] font-black tracking-[0.28em] text-cyan-300">СМЕНА ЗАВЕРШЕНА</div>

        <div className="mt-4 flex items-center gap-4 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-cyan-950/40 p-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/40 bg-cyan-400/10 text-5xl font-black text-cyan-200">
            {result.rating}
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Оценка смены</div>
            <div className="mt-1 text-lg font-black">{result.score} / 100</div>
            <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <Clock3 className="h-3.5 w-3.5" /> {minutes}:{seconds.toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <ResultStat label="Заказов" value={result.stats.completedOrders} />
          <ResultStat label="Заработано" value={`${result.stats.earnings.toLocaleString()} $`} icon={<Coins className="h-3.5 w-3.5" />} />
          <ResultStat label="Качество" value={`${Math.round(result.averageQuality)}%`} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
          <ResultStat label="Идеальных" value={result.stats.perfectRides} icon={<Star className="h-3.5 w-3.5" />} />
          <ResultStat label="VIP" value={result.stats.vipRides} />
          <ResultStat label="Аварий / отказов" value={`${result.stats.collisions} / ${result.stats.rejectedOrders}`} />
        </div>

        <div className="mt-3 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-200">XP за смену</span>
            <span className="text-xl font-black text-white">+{result.totalXpEarned} XP</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">Заказы: {result.stats.xpEarned} · бонус {result.rating}: +{result.completionBonusXp}</div>
          <div className="mt-3 flex items-center justify-between text-xs font-bold">
            <span>LEVEL {progress.level} · {progress.rank}</span>
            <span className="text-cyan-200">{progress.current} / {progress.required || 'MAX'} XP</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-500" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>

        {levelUp && (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-amber-300/40 bg-amber-400/10 p-3 text-amber-200">
            <Award className="h-5 w-5" />
            <span className="font-black">LEVEL UP! {result.levelBefore} → {result.levelAfter}</span>
          </div>
        )}

        <button onClick={onPrimary} className="mt-4 w-full rounded-xl bg-cyan-400 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300">
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

function ResultStat({ label, value, icon }: { label: string; value: string | number; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-500">{icon}{label}</div>
      <div className="mt-1 font-black text-slate-100">{value}</div>
    </div>
  );
}
