import { useEffect, useState } from 'react';
import { Pause, Play, Settings2, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { AudioEngine, type NeonFMState } from '../game/AudioEngine';
import type { PlayerSaveData } from '../types/game';

type VolumeKey = 'masterVolume' | 'engineVolume' | 'musicVolume';

interface NeonFMPlayerProps {
  settings: PlayerSaveData['settings'];
  onToggleMusic: () => void;
  onSetVolume: (key: VolumeKey, value: number) => void;
}

const MIXER_LABELS: ReadonlyArray<{ key: VolumeKey; label: string }> = [
  { key: 'masterVolume', label: 'MASTER' },
  { key: 'engineVolume', label: 'ENGINE' },
  { key: 'musicVolume', label: 'MUSIC' },
];

export function NeonFMPlayer({ settings, onToggleMusic, onSetVolume }: NeonFMPlayerProps) {
  const audio = AudioEngine.getInstance();
  const [state, setState] = useState<NeonFMState>(() => audio.getMusicState());
  const [mixerOpen, setMixerOpen] = useState(false);
  const [draftVolumes, setDraftVolumes] = useState(() => ({
    masterVolume: settings.masterVolume,
    engineVolume: settings.engineVolume,
    musicVolume: settings.musicVolume,
  }));

  useEffect(() => audio.subscribeMusicState(setState), [audio]);
  useEffect(() => {
    setDraftVolumes({
      masterVolume: settings.masterVolume,
      engineVolume: settings.engineVolume,
      musicVolume: settings.musicVolume,
    });
  }, [settings.masterVolume, settings.engineVolume, settings.musicVolume]);

  const previewVolume = (key: VolumeKey, value: number) => {
    setDraftVolumes(previous => ({ ...previous, [key]: value }));
    if (key === 'masterVolume') audio.setMasterVolume(value);
    else if (key === 'engineVolume') audio.setEngineVolume(value);
    else audio.setMusicVolume(value);
  };

  const commitVolume = (key: VolumeKey, value: number) => onSetVolume(key, value);
  const controlClass = 'grid h-7 w-7 place-items-center rounded-md border border-cyan-400/20 bg-slate-950/70 text-slate-300 transition hover:border-cyan-300/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <section
      id="neon-fm-player"
      aria-label="NEON FM music player"
      className="absolute right-3 top-16 w-[min(18rem,calc(100vw-1.5rem))] pointer-events-auto rounded-xl border border-cyan-400/35 bg-slate-950/90 p-2.5 shadow-xl shadow-cyan-950/40 backdrop-blur-md sm:right-5 sm:top-20"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[9px] font-black tracking-[0.24em] text-cyan-300">
            <span className={`h-1.5 w-1.5 rounded-full ${state.isPlaying ? 'animate-pulse bg-cyan-300' : 'bg-slate-600'}`} />
            {state.station}
          </div>
          <div id="neon-fm-track" className="truncate text-[11px] font-bold text-slate-100">{state.title}</div>
          <div className="truncate text-[9px] text-slate-400">{state.artist}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={controlClass} aria-label="Previous track" disabled={!state.canSkip} onClick={() => audio.previousMusicTrack()}>
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            id="neon-fm-play"
            className={`${controlClass} border-cyan-300/50 text-cyan-200`}
            aria-label={state.isPlaying ? 'Pause music' : 'Play music'}
            disabled={!state.hasTracks}
            onClick={() => {
              if (state.isPlaying) onToggleMusic();
              else if (!settings.musicEnabled) {
                audio.unlock();
                onToggleMusic();
              } else audio.unlock();
            }}
          >
            {settings.musicEnabled && state.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className={controlClass} aria-label="Next track" disabled={!state.canSkip} onClick={() => audio.nextMusicTrack()}>
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`${controlClass} ${state.shuffle ? 'text-cyan-300' : ''}`}
            aria-label="Toggle shuffle"
            disabled={!state.canSkip}
            onClick={() => audio.toggleMusicShuffle()}
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={controlClass} aria-label="Audio mixer" aria-expanded={mixerOpen} onClick={() => setMixerOpen(open => !open)}>
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {mixerOpen && (
        <div id="neon-fm-mixer" className="mt-2 space-y-1.5 border-t border-slate-700/70 pt-2">
          {MIXER_LABELS.map(({ key, label }) => (
            <label key={key} className="grid grid-cols-[3.5rem_1fr_2rem] items-center gap-2 text-[9px] font-bold tracking-wider text-slate-400">
              <span>{label}</span>
              <input
                id={`audio-${key}`}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={draftVolumes[key]}
                aria-label={`${label} volume`}
                className="h-1 accent-cyan-400"
                onChange={event => previewVolume(key, Number(event.currentTarget.value))}
                onPointerUp={event => commitVolume(key, Number(event.currentTarget.value))}
                onKeyUp={event => commitVolume(key, Number(event.currentTarget.value))}
                onBlur={event => commitVolume(key, Number(event.currentTarget.value))}
              />
              <span className="text-right tabular-nums text-cyan-200">{Math.round(draftVolumes[key] * 100)}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
