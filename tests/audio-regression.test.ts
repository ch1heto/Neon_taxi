import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CRUISE_VARIATION_LIMIT,
  EngineAudioModel,
  LEGACY_ENGINE_BASE_FREQUENCY,
  LEGACY_ENGINE_BASE_GAIN,
  LEGACY_ENGINE_FILTER_BASE,
  LEGACY_ENGINE_FILTER_SPAN,
  LEGACY_ENGINE_FREQUENCY_SPAN,
} from '../src/audio/EngineAudioModel';
import { clampAudioVolume, MusicPlaylist } from '../src/audio/MusicPlaylist';
import {
  MUSIC_TRACKS,
  PROCEDURAL_NEON_FM_PROGRAM,
  canMusicPlaybackRun,
  resolveMusicPlaybackMode,
  type MusicTrack,
} from '../src/audio/musicTracks';
import { AudioEngine } from '../src/game/AudioEngine';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';

const tracks: readonly MusicTrack[] = [
  { id: 'a', title: 'A', artist: 'Test', file: '/a.ogg', station: 'NEON FM' },
  { id: 'b', title: 'B', artist: 'Test', file: '/b.ogg', station: 'NEON FM' },
  { id: 'c', title: 'C', artist: 'Test', file: '/c.ogg', station: 'NEON FM' },
];

test('engine restores finite legacy speed curves with no runtime gear or RPM state', () => {
  const model = new EngineAudioModel();
  const speed = 0.5;
  const state = model.update(speed, 1, false, 1 / 60);
  const legacyFrequency = LEGACY_ENGINE_BASE_FREQUENCY + speed * LEGACY_ENGINE_FREQUENCY_SPAN;
  const legacyFilter = LEGACY_ENGINE_FILTER_BASE + speed * LEGACY_ENGINE_FILTER_SPAN;

  assert.equal('gear' in state, false);
  assert.equal('rpm' in state, false);
  assert.ok(Number.isFinite(state.mainFrequency));
  assert.ok(Number.isFinite(state.harmonicFrequency));
  assert.ok(Number.isFinite(state.filterFrequency));
  assert.ok(Number.isFinite(state.gain));
  assert.equal(state.mainFrequency, legacyFrequency);
  assert.equal(state.harmonicFrequency, legacyFrequency * 2.01);
  assert.equal(state.filterFrequency, legacyFilter);
  assert.equal(state.gain, LEGACY_ENGINE_BASE_GAIN);
  assert.equal(state.harmonicGain, 1);
});

test('engine runtime has no repeating noise source or artificial gearbox implementation', () => {
  const audioSource = readFileSync(new URL('../src/game/AudioEngine.ts', import.meta.url), 'utf8');
  const modelSource = readFileSync(new URL('../src/audio/EngineAudioModel.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(audioSource, /engineNoise|createBufferSource\(\)|\.loop\s*=\s*true/);
  assert.doesNotMatch(modelSource, /gear|upshift|downshift|shiftDrop|ENGINE_MAX_RPM/i);
});

test('stable cruise is quieter and softer, then old acceleration character returns quickly', () => {
  const model = new EngineAudioModel();
  let cruise = model.state;
  for (let frame = 0; frame < 360; frame++) cruise = model.update(0.55, 1, false, 1 / 60);
  const legacyFilterAtCruiseSpeed = LEGACY_ENGINE_FILTER_BASE + 0.55 * LEGACY_ENGINE_FILTER_SPAN;
  assert.ok(cruise.cruise > 0.95);
  assert.ok(cruise.gain <= LEGACY_ENGINE_BASE_GAIN * 0.7);
  assert.ok(cruise.filterFrequency < legacyFilterAtCruiseSpeed);
  assert.ok(cruise.harmonicGain < 0.75);

  let acceleration = cruise;
  for (let frame = 0; frame < 30; frame++) {
    acceleration = model.update(0.55 + frame * 0.008, 1, false, 1 / 60);
  }
  const expectedFrequency = LEGACY_ENGINE_BASE_FREQUENCY + (0.55 + 29 * 0.008) * LEGACY_ENGINE_FREQUENCY_SPAN;
  const expectedFilter = LEGACY_ENGINE_FILTER_BASE + (0.55 + 29 * 0.008) * LEGACY_ENGINE_FILTER_SPAN;
  assert.ok(acceleration.cruise < 0.03);
  assert.ok(acceleration.gain > LEGACY_ENGINE_BASE_GAIN * 0.99);
  assert.ok(Math.abs(acceleration.mainFrequency - expectedFrequency) < 0.02);
  assert.ok(Math.abs(acceleration.filterFrequency - expectedFilter) < 0.25);
  assert.ok(acceleration.harmonicGain > 0.99);
});

test('cruise variation is slow, non-static, finite, and bounded to a tiny range', () => {
  const model = new EngineAudioModel();
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let frame = 0; frame < 900; frame++) {
    const state = model.update(0.5, 0.2, false, 1 / 60);
    if (state.cruise > 0.95) {
      minimum = Math.min(minimum, state.variation);
      maximum = Math.max(maximum, state.variation);
      assert.ok(Math.abs(state.variation) <= CRUISE_VARIATION_LIMIT);
      assert.ok(Number.isFinite(state.mainFrequency));
    }
  }
  assert.ok(maximum - minimum > 0.001, 'variation should not freeze at one pitch');
});

test('empty file manifest exposes procedural NEON FM while real files keep playlist mode', () => {
  assert.equal(MUSIC_TRACKS.length, 0);
  assert.equal(resolveMusicPlaybackMode(MUSIC_TRACKS), 'procedural');
  assert.equal(resolveMusicPlaybackMode(tracks), 'playlist');
  assert.deepEqual(PROCEDURAL_NEON_FM_PROGRAM, {
    id: 'procedural-neon-drive',
    title: 'Neon Drive',
    artist: 'Neon Taxi',
    station: 'NEON FM',
  });

  const radio = AudioEngine.getInstance().getMusicState();
  assert.equal(radio.usingProceduralFallback, true);
  assert.equal(radio.hasTracks, true);
  assert.equal(radio.canSkip, false);
  assert.equal(radio.title, 'Neon Drive');
  assert.equal(radio.artist, 'Neon Taxi');
});

test('procedural station routes through fade, duck, MUSIC bus, and MASTER bus', () => {
  const source = readFileSync(new URL('../src/game/AudioEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /proceduralOutputGain\.connect\(this\.musicFadeGain\)/);
  assert.match(source, /musicFadeGain\.connect\(this\.musicDuckGain\)/);
  assert.match(source, /musicDuckGain\.connect\(this\.musicBusGain\)/);
  assert.match(source, /musicBusGain\.connect\(this\.masterGain\)/);
  assert.doesNotMatch(source, /proceduralOutputGain\.connect\(this\.ctx\.destination\)/);
});

test('music lifecycle policy pauses while hidden or game-paused and resumes only when allowed', () => {
  assert.equal(canMusicPlaybackRun(true, true, false), true);
  assert.equal(canMusicPlaybackRun(true, true, true), false);
  assert.equal(canMusicPlaybackRun(true, false, false), false);
  assert.equal(canMusicPlaybackRun(false, true, false), false);
});

test('music playlist is safe when empty and real-track pause/resume preserves the track', () => {
  const empty = new MusicPlaylist([]);
  assert.equal(empty.play(), null);
  assert.equal(empty.next(), null);
  assert.equal(empty.previous(), null);
  assert.equal(empty.current, null);

  const playlist = new MusicPlaylist(tracks, () => 0);
  assert.equal(playlist.play()?.id, 'a');
  playlist.pause();
  assert.equal(playlist.isPlaying, false);
  assert.equal(playlist.play()?.id, 'a');
  assert.equal(playlist.isPlaying, true);
});

test('shuffle never immediately repeats and next/previous retain history', () => {
  const shuffled = new MusicPlaylist(tracks, () => 0);
  let previous = shuffled.play()!.id;
  for (let step = 0; step < 12; step++) {
    const next = shuffled.next()!.id;
    assert.notEqual(next, previous);
    previous = next;
  }

  const ordered = new MusicPlaylist(tracks, () => 0);
  ordered.setShuffle(false);
  assert.equal(ordered.play()?.id, 'a');
  assert.equal(ordered.next()?.id, 'b');
  assert.equal(ordered.next()?.id, 'c');
  assert.equal(ordered.previous()?.id, 'b');
});

test('master/music volumes clamp and persisted mixer migration repairs invalid values', () => {
  assert.equal(clampAudioVolume(-4), 0);
  assert.equal(clampAudioVolume(0.42), 0.42);
  assert.equal(clampAudioVolume(3), 1);
  assert.equal(clampAudioVolume(Number.NaN), 0);

  const migrated = migrateSaveData({
    ...DEFAULT_SAVE_DATA,
    settings: {
      ...DEFAULT_SAVE_DATA.settings,
      masterVolume: 2,
      engineVolume: -1,
      musicVolume: Number.NaN,
    },
  });
  assert.equal(migrated.settings.masterVolume, 1);
  assert.equal(migrated.settings.engineVolume, 0);
  assert.equal(migrated.settings.musicVolume, DEFAULT_SAVE_DATA.settings.musicVolume);
});
