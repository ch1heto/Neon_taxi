/**
 * Web Audio Procedural Sound & Synthwave Music Engine
 * 
 * Преимущества для Яндекс Игр:
 * - 0 байт внешних аудиофайлов (нет задержек загрузки и проблем с CORS/404)
 * - Динамическое изменение тональности двигателя от скорости
 * - Мгновенная пауза и глушение звуков при открытии рекламы
 * - Корректная обработка разблокировки аудиоконтекста по первому тапу/клику
 */

export class AudioEngine {
  private static instance: AudioEngine;
  private ctx: AudioContext | null = null;
  private isUnlocked = false;

  private sfxEnabled = true;
  private musicEnabled = true;
  private isMutedForAdOrTab = false;

  // Music sequencer state
  private isMusicPlaying = false;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextMusicNoteTime = 0;
  private musicMasterGain: GainNode | null = null;
  private tabHidden = false;

  // Engine sound state
  private engineGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private isEngineRunning = false;

  private constructor() {
    // Автоматическая пауза при скрытии вкладки браузера
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.tabHidden = true;
          this.pauseMusicScheduler();
          if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
        } else {
          this.tabHidden = false;
          if (!this.isMutedForAdOrTab && this.isUnlocked && this.ctx) {
            this.ctx.resume().then(() => this.restartMusicScheduler()).catch(() => {});
          }
        }
      });
    }
  }

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  public init() {
    if (this.ctx) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
    } catch (e) {
      console.warn('[AudioEngine] Web Audio API не поддерживается:', e);
    }
  }

  public unlock() {
    this.init();
    if (!this.ctx) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.isUnlocked = true;
        if (this.musicEnabled && !this.isMusicPlaying) {
          this.startSynthwaveMusic();
        }
        if (!this.isEngineRunning) {
          this.startEngineSound();
        }
      }).catch(err => console.warn('[AudioEngine] Resume context failed:', err));
    } else {
      this.isUnlocked = true;
      if (this.musicEnabled && !this.isMusicPlaying) {
        this.startSynthwaveMusic();
      }
      if (!this.isEngineRunning) {
        this.startEngineSound();
      }
    }
  }

  public setMuted(muted: boolean) {
    this.isMutedForAdOrTab = muted;
    if (!this.ctx) return;

    if (muted) {
      this.pauseMusicScheduler();
      if (this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    } else {
      if (!this.tabHidden && this.ctx.state === 'suspended' && this.isUnlocked) {
        this.ctx.resume().then(() => this.restartMusicScheduler()).catch(() => {});
      } else if (!this.tabHidden) {
        this.restartMusicScheduler();
      }
    }
  }

  public setSfxEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
    if (this.engineGain) {
      this.engineGain.gain.value = enabled ? 0.04 : 0;
    }
  }

  public setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (enabled) {
      if (!this.isMusicPlaying && this.isUnlocked) {
        this.startSynthwaveMusic();
      }
      if (this.musicMasterGain) {
        this.musicMasterGain.gain.setValueAtTime(0.08, this.ctx?.currentTime || 0);
      }
    } else {
      if (this.musicMasterGain) {
        this.musicMasterGain.gain.setValueAtTime(0, this.ctx?.currentTime || 0);
      }
    }
  }

  public isSfx(): boolean {
    return this.sfxEnabled;
  }

  public isMusic(): boolean {
    return this.musicEnabled;
  }

  // --- Реалистичный звук двигателя машины ---
  public startEngineSound() {
    if (!this.ctx || this.isEngineRunning) return;

    try {
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = this.sfxEnabled ? 0.04 : 0;

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 140;

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 45;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 90;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      this.engineOsc1.start();
      this.engineOsc2.start();
      this.isEngineRunning = true;
    } catch (e) {
      console.warn('[AudioEngine] Engine start error:', e);
    }
  }

  public updateEngineRPM(speedNormalized: number) {
    if (!this.ctx || !this.isEngineRunning || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter) return;

    // Плавная модуляция питча и фильтра в зависимости от скорости (0.0 - 1.0)
    const baseFreq = 42 + speedNormalized * 65;
    const filterFreq = 120 + speedNormalized * 380;
    const now = this.ctx.currentTime;

    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);
  }

  // --- Звуковые эффекты (SFX) ---

  // Приятный звон монеты ("дзынь")
  public playCoinSound() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(987.77, now); // B5
      osc1.frequency.setValueAtTime(1318.51, now + 0.08); // E6
      osc2.frequency.setValueAtTime(1975.53, now); // B6
      osc2.frequency.setValueAtTime(2637.02, now + 0.08); // E7

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);
    } catch (e) {
      console.warn(e);
    }
  }

  // Звук активации Неонового Рывка (Neon Dash)
  public playDashSound() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
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
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn(e);
    }
  }

  // Звук столкновения со стеной или зданием
  public playCrashSound(intensity = 1.0) {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.2);

      const vol = Math.min(0.25, 0.1 * intensity);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      console.warn(e);
    }
  }

  // Звук посадки пассажира
  public playPickupSound() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
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
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn(e);
    }
  }

  // Звук успешной доставки
  public playDeliverySuccessSound() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        const startTime = now + idx * 0.08;
        gain.gain.setValueAtTime(0.1, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.35);
      });
    } catch (e) {
      console.warn(e);
    }
  }

  // Звук клика по элементам интерфейса
  public playUiClick() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.04);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      console.warn(e);
    }
  }

  // Звук покупки или улучшения в магазине
  public playUpgradeSound() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
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
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn(e);
    }
  }

  // Гудок автомобиля (клаксон)
  public playHonkSound() {
    if (!this.ctx || !this.sfxEnabled || !this.isUnlocked) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(415, now); // Соль-диез
      osc2.frequency.setValueAtTime(494, now); // Си (классический двухтоновый клаксон)

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.22);
      osc2.stop(now + 0.22);
    } catch (e) {
      console.warn(e);
    }
  }

  // --- Процедурный Synthwave саундтрек ---
  private startSynthwaveMusic() {
    if (!this.ctx) return;
    this.isMusicPlaying = true;

    this.musicMasterGain = this.ctx.createGain();
    this.musicMasterGain.gain.value = this.musicEnabled ? 0.08 : 0;
    this.musicMasterGain.connect(this.ctx.destination);

    // Киберпанк синтвейв бас-линия в стиле 80-х (A minor / F / G / E)
    const bassNotes = [
      110, 110, 110, 110,  110, 110, 110, 110,  // A2
      87.31, 87.31, 87.31, 87.31, 87.31, 87.31, 87.31, 87.31, // F2
      98, 98, 98, 98,  98, 98, 98, 98,          // G2
      82.41, 82.41, 82.41, 82.41, 82.41, 82.41, 82.41, 82.41 // E2
    ];

    const leadArp = [
      440, 523.25, 659.25, 880,  440, 523.25, 659.25, 880,
      349.23, 440, 523.25, 698.46, 349.23, 440, 523.25, 698.46,
      392, 493.88, 587.33, 783.99, 392, 493.88, 587.33, 783.99,
      329.63, 392, 493.88, 659.25, 329.63, 392, 493.88, 659.25
    ];

    this.nextMusicNoteTime = this.ctx.currentTime + 0.05;
    const stepDuration = 0.14; // ~107 BPM 16th notes

    const scheduleStep = (now: number) => {
      if (!this.ctx || !this.musicMasterGain) return;
      const step = this.musicStep % bassNotes.length;

      // 1. Synthwave Bass Pulse
      const bassFreq = bassNotes[step];
      const bassOsc = this.ctx.createOscillator();
      const bassFilter = this.ctx.createBiquadFilter();
      const bassGain = this.ctx.createGain();

      bassOsc.type = 'sawtooth';
      bassOsc.frequency.value = bassFreq;

      bassFilter.type = 'lowpass';
      bassFilter.frequency.setValueAtTime(350, now);
      bassFilter.frequency.exponentialRampToValueAtTime(140, now + 0.12);

      bassGain.gain.setValueAtTime(0.35, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      bassOsc.connect(bassFilter);
      bassFilter.connect(bassGain);
      bassGain.connect(this.musicMasterGain);

      bassOsc.start(now);
      bassOsc.stop(now + 0.13);

      // 2. Arpeggio Synth (каждые 2 шага)
      if (step % 2 === 0) {
        const leadFreq = leadArp[step];
        const leadOsc = this.ctx.createOscillator();
        const leadGain = this.ctx.createGain();

        leadOsc.type = 'triangle';
        leadOsc.frequency.value = leadFreq;

        leadGain.gain.setValueAtTime(0.12, now);
        leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        leadOsc.connect(leadGain);
        leadGain.connect(this.musicMasterGain);

        leadOsc.start(now);
        leadOsc.stop(now + 0.22);
      }

      this.musicStep++;
    };

    const scheduler = () => {
      if (!this.isMusicPlaying || !this.ctx || this.ctx.state !== 'running' || this.tabHidden || this.isMutedForAdOrTab) return;
      const horizon = this.ctx.currentTime + 0.12;
      while (this.nextMusicNoteTime < horizon) {
        scheduleStep(this.nextMusicNoteTime);
        this.nextMusicNoteTime += stepDuration;
      }
    };
    this.musicTimer = window.setInterval(scheduler, 25);
    scheduler();
  }

  private pauseMusicScheduler() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private restartMusicScheduler() {
    if (!this.ctx || !this.musicEnabled || !this.isUnlocked || this.tabHidden || this.isMutedForAdOrTab) return;
    this.pauseMusicScheduler();
    this.isMusicPlaying = false;
    this.startSynthwaveMusic();
  }

  public stop() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.isMusicPlaying = false;
  }
}
