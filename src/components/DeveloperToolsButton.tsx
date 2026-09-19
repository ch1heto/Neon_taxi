import { Wrench } from 'lucide-react';

export function DeveloperToolsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      id="hud-btn-debug"
      onClick={onOpen}
      title="SDK Панель"
      className="p-2 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/70 text-slate-400 hover:text-cyan-300 active:scale-95 transition-all shadow-md"
    >
      <Wrench className="w-4 h-4" />
    </button>
  );
}
