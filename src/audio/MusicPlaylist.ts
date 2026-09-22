import type { MusicTrack } from './musicTracks';

export function clampAudioVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampPlaybackOffset(value: number, duration: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(duration, value));
}

export function resolvePausedPlaybackOffset(
  initialOffset: number,
  startedAtAudioTime: number,
  currentAudioTime: number,
  duration: number,
): number {
  const elapsed = Number.isFinite(currentAudioTime) && Number.isFinite(startedAtAudioTime)
    ? Math.max(0, currentAudioTime - startedAtAudioTime)
    : 0;
  return clampPlaybackOffset(initialOffset + elapsed, duration);
}

export function shouldAutoAdvanceMusicSource(
  manuallyStopped: boolean,
  sourceGeneration: number,
  currentGeneration: number,
): boolean {
  return !manuallyStopped && sourceGeneration === currentGeneration;
}

export function isCurrentMusicLoad(
  requestGeneration: number,
  currentGeneration: number,
  requestedTrackId: string,
  currentTrackId: string | null,
): boolean {
  return requestGeneration === currentGeneration && requestedTrackId === currentTrackId;
}

export class MusicPlaylist {
  private index = -1;
  private playing = false;
  private shuffleEnabled = true;
  private readonly history: number[] = [];
  private historyCursor = -1;
  private readonly failedTrackIds = new Set<string>();
  private shuffleBag: number[] = [];

  constructor(
    private readonly tracks: readonly MusicTrack[],
    private readonly random: () => number = Math.random,
  ) {}

  public get count(): number { return this.tracks.length; }
  public get playableCount(): number { return this.availableIndices().length; }
  public get unavailableTrackIds(): ReadonlySet<string> { return this.failedTrackIds; }
  public get currentIndex(): number { return this.index; }
  public get current(): MusicTrack | null { return this.index >= 0 ? this.tracks[this.index] ?? null : null; }
  public get isPlaying(): boolean { return this.playing; }
  public get isShuffleEnabled(): boolean { return this.shuffleEnabled; }

  public play(): MusicTrack | null {
    if (this.playableCount === 0) {
      this.playing = false;
      return null;
    }
    if (this.index < 0 || !this.isIndexAvailable(this.index)) this.selectInitialTrack();
    this.playing = true;
    return this.current;
  }

  public pause(): void {
    this.playing = false;
  }

  public setShuffle(enabled: boolean): void {
    this.shuffleEnabled = enabled;
    this.shuffleBag = [];
  }

  public next(): MusicTrack | null {
    if (this.playableCount === 0) return null;
    for (let cursor = this.historyCursor + 1; cursor < this.history.length; cursor++) {
      if (this.isIndexAvailable(this.history[cursor])) {
        this.historyCursor = cursor;
        this.index = this.history[cursor];
        return this.current;
      }
    }
    const nextIndex = this.pickNextIndex(1);
    this.record(nextIndex);
    return this.current;
  }

  public previous(): MusicTrack | null {
    if (this.playableCount === 0) return null;
    for (let cursor = this.historyCursor - 1; cursor >= 0; cursor--) {
      if (this.isIndexAvailable(this.history[cursor])) {
        this.historyCursor = cursor;
        this.index = this.history[cursor];
        return this.current;
      }
    }
    const previousIndex = this.pickNextIndex(-1);
    this.record(previousIndex);
    return this.current;
  }

  /** Permanently excludes one broken source for this session and advances at most once. */
  public markFailed(trackId: string): MusicTrack | null {
    const failedIndex = this.tracks.findIndex(track => track.id === trackId);
    if (failedIndex < 0 || this.failedTrackIds.has(trackId)) return this.current;
    this.failedTrackIds.add(trackId);
    this.shuffleBag = this.shuffleBag.filter(index => index !== failedIndex);
    if (this.index !== failedIndex) return this.current;
    if (this.playableCount === 0) {
      this.index = -1;
      return null;
    }
    const nextIndex = this.pickNextIndex(1);
    this.record(nextIndex);
    return this.current;
  }

  private selectInitialTrack(): void {
    const initialIndex = this.shuffleEnabled
      ? this.takeFromShuffleBag()
      : this.availableIndices()[0];
    this.record(initialIndex);
  }

  private pickNextIndex(direction: 1 | -1): number {
    const available = this.availableIndices();
    const currentPosition = available.indexOf(this.index);
    if (currentPosition < 0) {
      const randomValue = clampAudioVolume(this.random());
      return available[Math.min(available.length - 1, Math.floor(randomValue * available.length))];
    }
    if (available.length === 1) return available[0];
    if (!this.shuffleEnabled) {
      return available[(currentPosition + direction + available.length) % available.length];
    }
    return this.takeFromShuffleBag();
  }

  private takeFromShuffleBag(): number {
    this.shuffleBag = this.shuffleBag.filter(index => this.isIndexAvailable(index));
    if (this.shuffleBag.length === 0) this.refillShuffleBag();
    return this.shuffleBag.shift()!;
  }

  private refillShuffleBag(): void {
    const bag = this.availableIndices();
    for (let index = bag.length - 1; index > 0; index--) {
      const randomValue = clampAudioVolume(this.random());
      const swapIndex = Math.min(index, Math.floor(randomValue * (index + 1)));
      [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
    }

    if (bag.length > 1 && bag[0] === this.index) {
      const replacement = bag.findIndex(candidate => candidate !== this.index);
      [bag[0], bag[replacement]] = [bag[replacement], bag[0]];
    }
    this.shuffleBag = bag;
  }

  private availableIndices(): number[] {
    const available: number[] = [];
    for (let index = 0; index < this.tracks.length; index++) {
      if (this.isIndexAvailable(index)) available.push(index);
    }
    return available;
  }

  private isIndexAvailable(index: number): boolean {
    const track = this.tracks[index];
    return Boolean(track && !this.failedTrackIds.has(track.id));
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
