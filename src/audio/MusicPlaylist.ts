import type { MusicTrack } from './musicTracks';

export function clampAudioVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export class MusicPlaylist {
  private index = -1;
  private playing = false;
  private shuffleEnabled = true;
  private readonly history: number[] = [];
  private historyCursor = -1;

  constructor(
    private readonly tracks: readonly MusicTrack[],
    private readonly random: () => number = Math.random,
  ) {}

  public get count(): number { return this.tracks.length; }
  public get currentIndex(): number { return this.index; }
  public get current(): MusicTrack | null { return this.index >= 0 ? this.tracks[this.index] ?? null : null; }
  public get isPlaying(): boolean { return this.playing; }
  public get isShuffleEnabled(): boolean { return this.shuffleEnabled; }

  public play(): MusicTrack | null {
    if (this.tracks.length === 0) {
      this.playing = false;
      return null;
    }
    if (this.index < 0) this.selectInitialTrack();
    this.playing = true;
    return this.current;
  }

  public pause(): void {
    this.playing = false;
  }

  public setShuffle(enabled: boolean): void {
    this.shuffleEnabled = enabled;
  }

  public next(): MusicTrack | null {
    if (this.tracks.length === 0) return null;
    if (this.historyCursor < this.history.length - 1) {
      this.historyCursor++;
      this.index = this.history[this.historyCursor];
      return this.current;
    }
    const nextIndex = this.pickNextIndex(1);
    this.record(nextIndex);
    return this.current;
  }

  public previous(): MusicTrack | null {
    if (this.tracks.length === 0) return null;
    if (this.historyCursor > 0) {
      this.historyCursor--;
      this.index = this.history[this.historyCursor];
      return this.current;
    }
    const previousIndex = this.pickNextIndex(-1);
    this.record(previousIndex);
    return this.current;
  }

  private selectInitialTrack(): void {
    const randomValue = clampAudioVolume(this.random());
    const initialIndex = Math.min(this.tracks.length - 1, Math.floor(randomValue * this.tracks.length));
    this.record(initialIndex);
  }

  private pickNextIndex(direction: 1 | -1): number {
    if (this.index < 0) {
      const randomValue = clampAudioVolume(this.random());
      return Math.min(this.tracks.length - 1, Math.floor(randomValue * this.tracks.length));
    }
    if (this.tracks.length === 1) return 0;
    if (!this.shuffleEnabled) return (this.index + direction + this.tracks.length) % this.tracks.length;
    const randomValue = clampAudioVolume(this.random());
    const offset = 1 + Math.min(this.tracks.length - 2, Math.floor(randomValue * (this.tracks.length - 1)));
    return (this.index + (direction === 1 ? offset : -offset) + this.tracks.length) % this.tracks.length;
  }

  private record(index: number): void {
    if (this.historyCursor < this.history.length - 1) this.history.splice(this.historyCursor + 1);
    this.index = index;
    this.history.push(index);
    this.historyCursor = this.history.length - 1;
    if (this.history.length > 64) {
      this.history.shift();
      this.historyCursor--;
    }
  }
}
