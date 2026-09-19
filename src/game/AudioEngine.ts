import { EngineAudioModel, LEGACY_ENGINE_BASE_GAIN } from '../audio/EngineAudioModel';
import { clampAudioVolume, MusicPlaylist } from '../audio/MusicPlaylist';
import {
  MUSIC_TRACKS,
  NEON_FM_STATION,
  PROCEDURAL_NEON_FM_PROGRAM,
  canMusicPlaybackRun,
  resolveMusicPlaybackMode,
  type MusicTrack,
} from '../audio/musicTracks';

export interface NeonFMState {
  station: typeof NEON_FM_STATION;
  title: string;
  artist: string;
  hasTracks: boolean;
  isPlaying: boolean;
  shuffle: boolean;
  trackIndex: number;
  trackCount: number;
  canSkip: boolean;
  usingProceduralFallback: boolean;
}

type MusicStateListener = (state: NeonFMState) => void;

const MUSIC_TRIM = 0.36;
const TRACK_FADE_SECONDS = 0.42;
const PROCEDURAL_MIX_GAIN = 0.62;
const PROCEDURAL_STEP_SECONDS = 0.14;
const PROCEDURAL_BASS_NOTES = Object.freeze([
  110, 110, 110, 110, 110, 110, 110, 110,
  87.31, 87.31, 87.31, 87.31, 87.31, 87.31, 87.31, 87.31,
  98, 98, 98, 98, 98, 98, 98, 98,
  82.41, 82.41, 82.41, 82.41, 82.41, 82.41, 82.41, 82.41,
]);
const PROCEDURAL_LEAD_NOTES = Object.freeze([
  440, 523.25, 659.25, 880, 440, 523.25, 659.25, 880,
  349.23, 440, 523.25, 698.46, 349.23, 440, 523.25, 698.46,
  392, 493.88, 587.33, 783.99, 392, 493.88, 587.33, 783.99,
  329.63, 392, 493.88, 659.25, 329.63, 392, 493.88, 659.25,
]);

/** Persistent WebAudio graph plus a single local-file NEON FM player. */
export class AudioEngine {
  private static instance: AudioEngine;
  private ctx: AudioContext | null = null;
  private isUnlocked = false;
  private initializationWarningShown = false;

  private sfxEnabled = true;
  private musicEnabled = true;
  private masterVolume = 0.8;
  private engineVolume = 0.8;
  private musicVolume = 0.45;
  private isMutedForAdOrPause = false;
  private tabHidden = false;
  private windowBlurred = false;

  private masterGain: GainNode | null = null;
  private sfxBusGain: GainNode | null = null;
  private engineBusGain: GainNode | null = null;
  private musicBusGain: GainNode | null = null;
  private musicDuckGain: GainNode | null = null;
  private musicFadeGain: GainNode | null = null;
  private proceduralOutputGain: GainNode | null = null;

  private engineGain: GainNode | null = null;
  private engineHarmonicGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private isEngineRunning = false;
  private readonly engineModel = new EngineAudioModel();

  private readonly playlist = new MusicPlaylist(MUSIC_TRACKS);
  private readonly musicListeners = new Set<MusicStateListener>();
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private loadedTrackId: string | null = null;
  private musicAudible = false;
  private musicSwitchTimer: number | null = null;
  private proceduralTimer: number | null = null;
  private proceduralStep = 0;
  private nextProceduralNoteTime = 0;
  private proceduralPlaying = false;

  private constructor() {
    if (typeof document !== 'undefined') {
      this.tabHidden = document.hidden;
      document.addEventListener('visibilitychange', () => {
        this.tabHidden = document.hidden;
        this.syncLifecycleState();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', () => {
        this.windowBlurred = true;
        this.syncLifecycleState();
      });
      window.addEventListener('focus', () => {
        this.windowBlurred = false;
        this.syncLifecycleState();
      });
    }
  }

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) AudioEngine.instance = new AudioEngine();
    return AudioEngine.instance;
  }

  public init(): void {
    if (this.ctx || typeof window === 'undefined') return;
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.createPersistentGraph();
    } catch (error) {
      if (!this.initializationWarningShown) {
        this.initializationWarningShown = true;
        console.warn('[AudioEngine] Web Audio API is unavailable:', error);
      }
    }
  }

  public unlock(): void {
    this.init();
    if (!this.ctx) return;
    this.isUnlocked = true;
    if (this.musicEnabled) this.playlist.play();
    if (this.isLifecycleSuspended()) {
      this.syncLifecycleState();
      this.emitMusicState();
      return;
    }
    const afterResume = () => {
      this.startEngineSound();
      this.syncMusicPlayback();
    };
    if (this.ctx.state === 'suspended') this.ctx.resume().then(afterResume).catch(() => {});
    else afterResume();
  }

  public applySettings(settings: {
    soundEnabled: boolean;
    musicEnabled: boolean;
    masterVolume: number;
    engineVolume: number;
    musicVolume: number;
  }): void {
    this.setMasterVolume(settings.masterVolume);
    this.setEngineVolume(settings.engineVolume);
    this.setMusicVolume(settings.musicVolume);
    this.setSfxEnabled(settings.soundEnabled);
    this.setMusicEnabled(settings.musicEnabled);
  }

  public setMuted(muted: boolean): void {
    this.isMutedForAdOrPause = muted;
    this.syncLifecycleState();
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    this.applyMixerTargets();
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) this.playlist.play();
    else this.playlist.pause();
    this.applyMixerTargets();
    this.syncMusicPlayback(true);
  }

  public setMasterVolume(value: number): void {
    this.masterVolume = clampAudioVolume(value);
    this.applyMixerTargets();
  }

  public setEngineVolume(value: number): void {
    this.engineVolume = clampAudioVolume(value);
    this.applyMixerTargets();
  }

  public setMusicVolume(value: number): void {
    this.musicVolume = clampAudioVolume(value);
    this.applyMixerTargets();
  }

  public isSfx(): boolean { return this.sfxEnabled; }
  public isMusic(): boolean { return this.musicEnabled; }

  public getMusicState(): NeonFMState {
    const track = this.playlist.current;
    const usingProceduralFallback = resolveMusicPlaybackMode(MUSIC_TRACKS) === 'procedural';
    return {
      station: NEON_FM_STATION,
      title: track?.title ?? PROCEDURAL_NEON_FM_PROGRAM.title,
      artist: track?.artist ?? PROCEDURAL_NEON_FM_PROGRAM.artist,
      hasTracks: this.playlist.count > 0 || usingProceduralFallback,
      isPlaying: (usingProceduralFallback ? this.proceduralPlaying : this.musicAudible) && this.musicEnabled,
      shuffle: this.playlist.isShuffleEnabled,
      trackIndex: this.playlist.currentIndex,
      trackCount: this.playlist.count,
      canSkip: this.playlist.count > 1,
      usingProceduralFallback,
    };
  }

  public subscribeMusicState(listener: MusicStateListener): () => void {
    this.musicListeners.add(listener);
    listener(this.getMusicState());
    return () => this.musicListeners.delete(listener);
  }

  public nextMusicTrack(): void {
    const track = this.playlist.next();
    if (track) this.switchMusicTrack(track);
    this.emitMusicState();
  }

  public previousMusicTrack(): void {
    const track = this.playlist.previous();
    if (track) this.switchMusicTrack(track);
    this.emitMusicState();
  }

  public toggleMusicShuffle(): void {
    this.playlist.setShuffle(!this.playlist.isShuffleEnabled);
    this.emitMusicState();
  }

  public startEngineSound(): void {
    if (!this.ctx || this.isEngineRunning || !this.engineGain || !this.engineFilter || !this.engineHarmonicGain) return;
    try {
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 45;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 90;
      this.engineGain.gain.value = LEGACY_ENGINE_BASE_GAIN;
      this.engineHarmonicGain.gain.value = 1;
      this.engineFilter.frequency.value = 140;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineHarmonicGain);
      this.engineHarmonicGain.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);

      this.engineOsc1.start();
      this.engineOsc2.start();
      this.isEngineRunning = true;
    } catch (error) {
      console.warn('[AudioEngine] Engine start failed:', error);
    }
  }

  /** Hot path: stable model state and stable nodes; no per-frame allocations. */
  public updateEngineRPM(speedNormalized: number, throttle = 0, braking = false, dt = 1 / 60): void {
    const state = this.engineModel.update(speedNormalized, throttle, braking, dt);
    if (!this.ctx || !this.isEngineRunning || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter ||
        !this.engineGain || !this.engineHarmonicGain) return;
    const now = this.ctx.currentTime;
    this.engineOsc1.frequency.setTargetAtTime(state.mainFrequency, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(state.harmonicFrequency, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(state.filterFrequency, now, 0.05);
    this.engineGain.gain.setTargetAtTime(state.gain, now, state.cruise > 0.01 ? 0.09 : 0.045);
    this.engineHarmonicGain.gain.setTargetAtTime(state.harmonicGain, now, state.cruise > 0.01 ? 0.1 : 0.045);
    this.musicDuckGain?.gain.setTargetAtTime(1 - state.musicLoad * 0.32, now, 0.16);
  }

  public playCoinSound(): void {
    this.playDualTone(987.77, 1975.53, 1318.51, 2637.02, 0.12, 0.5, 0.08);
  }

  public playDashSound(): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
    filter.Q.value = 3;
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBusGain!);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playCrashSound(intensity = 1): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.2);
    gain.gain.setValueAtTime(Math.min(0.25, 0.1 * intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.sfxBusGain!);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playPickupSound(): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(659.25, now + 0.1);
    osc.frequency.setValueAtTime(880, now + 0.2);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(this.sfxBusGain!);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playDeliverySuccessSound(): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const now = this.ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + i * 0.08;
      osc.type = 'triangle';
      osc.frequency.value = notes[i];
      gain.gain.setValueAtTime(0.1, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(this.sfxBusGain!);
      osc.start(start);
      osc.stop(start + 0.35);
    }
  }

  public playUiClick(): void {
    this.playSweep(800, 1400, 0.08, 0.05);
  }

  public playUpgradeSound(): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.25);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.sfxBusGain!);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  public playHonkSound(): void {
    this.playDualTone(415, 494, 415, 494, 0.08, 0.22, 0);
  }

  public stop(): void {
    this.pauseAllMusic(false);
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  private createPersistentGraph(): void {
    if (!this.ctx || this.masterGain) return;
    this.masterGain = this.ctx.createGain();
    this.sfxBusGain = this.ctx.createGain();
    this.engineBusGain = this.ctx.createGain();
    this.musicBusGain = this.ctx.createGain();
    this.musicDuckGain = this.ctx.createGain();
    this.musicFadeGain = this.ctx.createGain();
    this.proceduralOutputGain = this.ctx.createGain();
    this.engineGain = this.ctx.createGain();
    this.engineHarmonicGain = this.ctx.createGain();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1;

    this.sfxBusGain.connect(this.masterGain);
    this.engineGain.connect(this.engineBusGain);
    this.engineBusGain.connect(this.masterGain);
    this.proceduralOutputGain.connect(this.musicFadeGain);
    this.musicFadeGain.connect(this.musicDuckGain);
    this.musicDuckGain.connect(this.musicBusGain);
    this.musicBusGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.musicDuckGain.gain.value = 1;
    this.musicFadeGain.gain.value = 1;
    this.proceduralOutputGain.gain.value = PROCEDURAL_MIX_GAIN;
    this.applyMixerTargets();

    if (this.playlist.count > 0 && typeof Audio !== 'undefined') {
      this.musicElement = new Audio();
      this.musicElement.preload = 'metadata';
      this.musicElement.addEventListener('ended', () => this.nextMusicTrack());
      this.musicElement.addEventListener('pause', () => {
        this.musicAudible = false;
        this.emitMusicState();
      });
      this.musicElement.addEventListener('playing', () => {
        this.musicAudible = true;
        this.emitMusicState();
      });
      this.musicSource = this.ctx.createMediaElementSource(this.musicElement);
      this.musicSource.connect(this.musicFadeGain);
    }
  }

  private applyMixerTargets(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.masterGain?.gain.setTargetAtTime(this.masterVolume, now, 0.04);
    this.sfxBusGain?.gain.setTargetAtTime(this.sfxEnabled ? 0.78 : 0, now, 0.04);
    this.engineBusGain?.gain.setTargetAtTime(this.sfxEnabled ? this.engineVolume : 0, now, 0.055);
    this.musicBusGain?.gain.setTargetAtTime(this.musicEnabled ? this.musicVolume * MUSIC_TRIM : 0, now, 0.07);
  }

  private syncLifecycleState(): void {
    if (!this.ctx) return;
    if (this.isLifecycleSuspended()) {
      this.pauseAllMusic(false);
      if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
      return;
    }
    if (!this.isUnlocked) return;
    const afterResume = () => {
      this.startEngineSound();
      this.syncMusicPlayback();
    };
    if (this.ctx.state === 'suspended') this.ctx.resume().then(afterResume).catch(() => {});
    else afterResume();
  }

  private isLifecycleSuspended(): boolean {
    return this.isMutedForAdOrPause || this.tabHidden || this.windowBlurred;
  }

  private syncMusicPlayback(fade = false): void {
    const shouldPlay = canMusicPlaybackRun(this.musicEnabled, this.isUnlocked, this.isLifecycleSuspended());
    if (resolveMusicPlaybackMode(MUSIC_TRACKS) === 'procedural') {
      if (shouldPlay) this.startProceduralMusic();
      else this.pauseProceduralMusic(fade);
      this.emitMusicState();
      return;
    }
    if (!this.musicElement) {
      this.musicAudible = false;
      this.emitMusicState();
      return;
    }
    if (!shouldPlay || !this.playlist.isPlaying) {
      this.pauseMusicElement(fade);
      return;
    }
    const track = this.playlist.current ?? this.playlist.play();
    if (!track) return;
    if (this.loadedTrackId !== track.id) this.switchMusicTrack(track);
    else this.playMusicElement();
  }

  private switchMusicTrack(track: MusicTrack): void {
    if (!this.musicElement || !this.ctx || !this.musicFadeGain) return;
    if (this.musicSwitchTimer !== null) window.clearTimeout(this.musicSwitchTimer);
    const load = () => {
      if (!this.musicElement || !this.ctx || !this.musicFadeGain) return;
      this.loadedTrackId = track.id;
      this.musicElement.src = track.file;
      this.musicElement.load();
      const now = this.ctx.currentTime;
      this.musicFadeGain.gain.cancelScheduledValues(now);
      this.musicFadeGain.gain.setValueAtTime(0.0001, now);
      this.musicFadeGain.gain.linearRampToValueAtTime(1, now + TRACK_FADE_SECONDS);
      if (this.musicEnabled && this.playlist.isPlaying && this.isUnlocked && !this.isLifecycleSuspended()) {
        this.playMusicElement();
      }
      this.emitMusicState();
    };
    if (this.loadedTrackId) {
      const now = this.ctx.currentTime;
      this.musicFadeGain.gain.cancelScheduledValues(now);
      this.musicFadeGain.gain.setValueAtTime(this.musicFadeGain.gain.value, now);
      this.musicFadeGain.gain.linearRampToValueAtTime(0.0001, now + TRACK_FADE_SECONDS);
      this.musicSwitchTimer = window.setTimeout(load, TRACK_FADE_SECONDS * 1000);
    } else load();
  }

  private playMusicElement(): void {
    if (!this.musicElement) return;
    if (this.ctx && this.musicFadeGain) {
      const now = this.ctx.currentTime;
      this.musicFadeGain.gain.cancelScheduledValues(now);
      this.musicFadeGain.gain.setValueAtTime(this.musicFadeGain.gain.value, now);
      this.musicFadeGain.gain.linearRampToValueAtTime(1, now + TRACK_FADE_SECONDS);
    }
    const playPromise = this.musicElement.play();
    if (playPromise) playPromise.catch(() => {
      this.musicAudible = false;
      this.emitMusicState();
    });
  }

  private pauseMusicElement(fade: boolean): void {
    if (!this.musicElement) return;
    if (!fade || !this.ctx || !this.musicFadeGain) {
      this.musicElement.pause();
      return;
    }
    const now = this.ctx.currentTime;
    this.musicFadeGain.gain.cancelScheduledValues(now);
    this.musicFadeGain.gain.setValueAtTime(this.musicFadeGain.gain.value, now);
    this.musicFadeGain.gain.linearRampToValueAtTime(0.0001, now + TRACK_FADE_SECONDS);
    window.setTimeout(() => {
      if (!this.musicEnabled || this.isLifecycleSuspended()) this.musicElement?.pause();
    }, TRACK_FADE_SECONDS * 1000);
  }

  private startProceduralMusic(): void {
    if (!this.ctx || !this.proceduralOutputGain || !this.musicFadeGain || this.proceduralPlaying) return;
    this.proceduralPlaying = true;
    this.nextProceduralNoteTime = this.ctx.currentTime + 0.05;
    const now = this.ctx.currentTime;
    this.musicFadeGain.gain.cancelScheduledValues(now);
    this.musicFadeGain.gain.setValueAtTime(0.0001, now);
    this.musicFadeGain.gain.linearRampToValueAtTime(1, now + TRACK_FADE_SECONDS);
    this.proceduralTimer = window.setInterval(this.runProceduralScheduler, 25);
    this.runProceduralScheduler();
  }

  private pauseProceduralMusic(fade: boolean): void {
    if (this.proceduralTimer !== null) {
      window.clearInterval(this.proceduralTimer);
      this.proceduralTimer = null;
    }
    this.proceduralPlaying = false;
    this.nextProceduralNoteTime = 0;
    if (fade && this.ctx && this.musicFadeGain) {
      const now = this.ctx.currentTime;
      this.musicFadeGain.gain.cancelScheduledValues(now);
      this.musicFadeGain.gain.setValueAtTime(this.musicFadeGain.gain.value, now);
      this.musicFadeGain.gain.linearRampToValueAtTime(0.0001, now + TRACK_FADE_SECONDS);
    }
  }

  private pauseAllMusic(fade: boolean): void {
    this.pauseMusicElement(fade);
    this.pauseProceduralMusic(fade);
    this.emitMusicState();
  }

  private readonly runProceduralScheduler = (): void => {
    if (!this.proceduralPlaying || !this.ctx || this.ctx.state !== 'running' ||
        this.isLifecycleSuspended() || !this.musicEnabled) return;
    const horizon = this.ctx.currentTime + 0.12;
    while (this.nextProceduralNoteTime < horizon) {
      this.scheduleProceduralStep(this.nextProceduralNoteTime);
      this.nextProceduralNoteTime += PROCEDURAL_STEP_SECONDS;
    }
  };

  private scheduleProceduralStep(now: number): void {
    if (!this.ctx || !this.proceduralOutputGain) return;
    const step = this.proceduralStep % PROCEDURAL_BASS_NOTES.length;

    const bassOsc = this.ctx.createOscillator();
    const bassFilter = this.ctx.createBiquadFilter();
    const bassGain = this.ctx.createGain();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.value = PROCEDURAL_BASS_NOTES[step];
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(350, now);
    bassFilter.frequency.exponentialRampToValueAtTime(140, now + 0.12);
    bassGain.gain.setValueAtTime(0.35, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.proceduralOutputGain);
    bassOsc.start(now);
    bassOsc.stop(now + 0.13);

    if (step % 2 === 0) {
      const leadOsc = this.ctx.createOscillator();
      const leadGain = this.ctx.createGain();
      leadOsc.type = 'triangle';
      leadOsc.frequency.value = PROCEDURAL_LEAD_NOTES[step];
      leadGain.gain.setValueAtTime(0.12, now);
      leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      leadOsc.connect(leadGain);
      leadGain.connect(this.proceduralOutputGain);
      leadOsc.start(now);
      leadOsc.stop(now + 0.22);
    }

    this.proceduralStep++;
  }

  private emitMusicState(): void {
    if (this.musicListeners.size === 0) return;
    const state = this.getMusicState();
    this.musicListeners.forEach(listener => listener(state));
  }

  private canPlaySfx(): boolean {
    return !!this.ctx && this.sfxEnabled && this.isUnlocked && !this.isLifecycleSuspended();
  }

  private playSweep(startFrequency: number, endFrequency: number, volume: number, duration: number): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFrequency, now);
    osc.frequency.exponentialRampToValueAtTime(endFrequency, now + duration * 0.8);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.sfxBusGain!);
    osc.start(now);
    osc.stop(now + duration);
  }

  private playDualTone(
    firstFrequency: number,
    secondFrequency: number,
    firstEndFrequency: number,
    secondEndFrequency: number,
    volume: number,
    duration: number,
    changeAt: number,
  ): void {
    if (!this.canPlaySfx() || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(firstFrequency, now);
    osc2.frequency.setValueAtTime(secondFrequency, now);
    if (changeAt > 0) {
      osc1.frequency.setValueAtTime(firstEndFrequency, now + changeAt);
      osc2.frequency.setValueAtTime(secondEndFrequency, now + changeAt);
    }
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.sfxBusGain!);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  }
}
