import { useEffect, useState } from 'react';
import { CalendarDays, Check, Coins, Star, X } from 'lucide-react';
import type { ContractPeriod, PlayerSaveData } from '../types/game';
import { getContractDefinition } from '../game/ContractSystem';

interface ContractsModalProps {
  isOpen: boolean;
  saveData: PlayerSaveData;
  onClose: () => void;
  onClaim: (period: ContractPeriod, contractId: string) => void;
}

const PERIOD_LABELS: Readonly<Record<ContractPeriod, string>> = Object.freeze({
  daily: 'ЕЖЕДНЕВНЫЕ',
  weekly: 'ЕЖЕНЕДЕЛЬНЫЕ',
});

export function ContractsModal({ isOpen, saveData, onClose, onClaim }: ContractsModalProps) {
  const [period, setPeriod] = useState<ContractPeriod>('daily');

  useEffect(() => {
    if (isOpen) setPeriod('daily');
  }, [isOpen]);

  if (!isOpen) return null;
  const state = saveData.contracts[period];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/88 p-3 font-sans text-slate-100 backdrop-blur-md">
      <section
        id="contracts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Задания"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-cyan-400/35 bg-slate-950 shadow-2xl shadow-cyan-950/50"
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-lg font-black tracking-[0.14em] text-cyan-200">
              <CalendarDays className="h-5 w-5" /> ЗАДАНИЯ
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Контракты Neon Taxi</div>
          </div>
          <button onClick={onClose} aria-label="Закрыть задания" className="rounded-xl border border-slate-700 p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2 px-4 pt-4 sm:px-6">
          {(['daily', 'weekly'] as const).map(candidate => (
            <button
              key={candidate}
              id={`contracts-tab-${candidate}`}
              onClick={() => setPeriod(candidate)}
              className={`rounded-xl border px-3 py-2 text-xs font-black tracking-wider transition ${
                period === candidate
                  ? 'border-cyan-300 bg-cyan-400 text-slate-950'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              {PERIOD_LABELS[candidate]}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-3">
            {state.items.map(item => {
              const definition = getContractDefinition(item.contractId);
              if (!definition) return null;
              const progress = Math.min(item.progress, item.target);
              const percent = item.target > 0 ? Math.min(100, progress / item.target * 100) : 0;
              const stateLabel = item.claimed ? 'ПОЛУЧЕНО' : item.completed ? 'ГОТОВО' : 'В ПРОЦЕССЕ';
              return (
                <article key={item.contractId} className={`rounded-2xl border p-4 ${item.completed && !item.claimed ? 'border-amber-300/55 bg-amber-400/10' : 'border-slate-800 bg-slate-900/80'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-white">{definition.title}</h3>
                      <p className="mt-1 text-xs text-slate-400">{definition.description}</p>
                    </div>
                    <span className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-black tracking-wider ${
                      item.claimed
                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                        : item.completed
                          ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
                          : 'border-slate-700 bg-slate-950 text-slate-400'
                    }`}>
                      {stateLabel}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-400">ПРОГРЕСС</span>
                    <span className="tabular-nums text-cyan-200">{progress.toLocaleString()} / {item.target.toLocaleString()}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full rounded-full transition-all ${item.completed ? 'bg-amber-300' : 'bg-cyan-400'}`} style={{ width: `${percent}%` }} />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 text-xs font-black">
                      <span className="flex items-center gap-1 rounded-lg bg-amber-400/10 px-2 py-1 text-amber-300"><Coins className="h-3.5 w-3.5" /> +{definition.rewardCoins.toLocaleString()} $</span>
                      <span className="flex items-center gap-1 rounded-lg bg-fuchsia-400/10 px-2 py-1 text-fuchsia-300"><Star className="h-3.5 w-3.5" /> +{definition.rewardXp} XP</span>
                    </div>
                    {item.completed && !item.claimed && (
                      <button
                        id={`claim-${item.contractId}`}
                        onClick={() => onClaim(period, item.contractId)}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-200 active:scale-95"
                      >
                        <Check className="h-4 w-4" /> ЗАБРАТЬ
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-center text-[11px] text-cyan-100/75">
            {period === 'daily' ? 'Ежедневные задания обновятся завтра' : 'Еженедельные задания обновятся на следующей неделе'}
          </div>
        </div>
      </section>
    </div>
  );
}
