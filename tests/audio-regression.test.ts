import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
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
import {
  clampAudioVolume,
  clampPlaybackOffset,
  isCurrentMusicLoad,
  MusicPlaylist,
  resolvePausedPlaybackOffset,
  shouldAutoAdvanceMusicSource,
} from '../src/audio/MusicPlaylist';
import {
  MUSIC_TRACKS,
  MUSIC_CREDITS,
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
  assert.doesNotMatch(audioSource, /engineNoise|\.loop\s*=\s*true/);
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

test('NEON FM manifest contains exactly the eight licensed production tracks', () => {
  assert.equal(MUSIC_TRACKS.length, 8);
  assert.deepEqual(MUSIC_TRACKS.map(track => [track.title, track.artist, track.file]), [
    ['Machina', 'Scott Buckley', '/assets/music/scott-buckley-machina.mp3'],
    ['Pure', 'Roa Music', '/assets/music/roa-music-pure.mp3'],
    ['Summer Evening', 'Keys of Moon', '/assets/music/keys-of-moon-summer-evening.mp3'],
    ['Aimless', 'Ketsa', '/assets/music/ketsa-aimless.mp3'],
    ['Cities', 'Ketsa', '/assets/music/ketsa-cities.mp3'],
    ['Falling Sky', 'Ketsa', '/assets/music/ketsa-falling-sky.mp3'],
    ['Internal Backchat', 'Ketsa', '/assets/music/ketsa-internal-backchat.mp3'],
    ['Lighting the Night', 'Ketsa', '/assets/music/ketsa-lighting-the-night.mp3'],
  ]);
  assert.ok(MUSIC_TRACKS.every(track => !/[\s\u0400-\u04ff]/u.test(track.file)));
  assert.equal(new Set(MUSIC_TRACKS.map(track => track.id)).size, MUSIC_TRACKS.length);
  assert.equal(resolveMusicPlaybackMode([]), 'procedural');
  assert.equal(resolveMusicPlaybackMode(tracks), 'playlist');
  assert.deepEqual(PROCEDURAL_NEON_FM_PROGRAM, {
    id: 'procedural-neon-drive',
    title: 'Neon Drive',
    artist: 'Neon Taxi',
    station: 'NEON FM',
  });

  const radio = AudioEngine.getInstance().getMusicState();
  assert.equal(radio.usingProceduralFallback, false);
  assert.equal(radio.hasTracks, true);
  assert.equal(radio.canSkip, true);
  assert.equal(radio.trackCount, 8);
  assert.equal(radio.title, 'Machina');
  assert.equal(radio.artist, 'Scott Buckley');

  for (const track of MUSIC_TRACKS) {
    const sourceFile = new URL(`../public${track.file}`, import.meta.url);
    assert.ok(statSync(sourceFile).size > 1_000_000, `${track.file} should be a bundled MP3`);
  }
});

test('music credits contain every artist and required license', () => {
  assert.deepEqual(MUSIC_CREDITS, [
    { title: 'Machina', artist: 'Scott Buckley', license: 'CC BY 4.0' },
    { title: 'Pure', artist: 'Roa Music', license: 'CC BY 3.0' },
    { title: 'Summer Evening', artist: 'Keys of Moon', license: 'CC BY 4.0' },
    { title: 'Aimless', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' },
    { title: 'Cities', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' },
    { title: 'Falling Sky', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' },
    { title: 'Internal Backchat', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' },
    { title: 'Lighting the Night', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' },
  ]);
  const licenseText = readFileSync(new URL('../public/THIRD_PARTY_MUSIC_LICENSES.md', import.meta.url), 'utf8');
  for (const credit of MUSIC_CREDITS) {
    assert.match(licenseText, new RegExp(credit.artist));
    assert.match(licenseText, new RegExp(credit.license.replace('.', '\\.')));
  }
});

test('NEON FM real tracks use Web Audio buffers through the MUSIC mixer with a two-buffer cache', () => {
  const source = readFileSync(new URL('../src/game/AudioEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /fetch\(track\.file/);
  assert.match(source, /decodeAudioData\(encodedAudio\)/);
  assert.match(source, /createBufferSource\(\)/);
  assert.match(source, /source\.connect\(gain\)/);
  assert.match(source, /gain\.connect\(this\.musicDuckGain\)/);
  assert.match(source, /MAX_DECODED_MUSIC_BUFFERS = 2/);
  assert.doesNotMatch(source, /new Audio\s*\(|HTMLAudioElement|createMediaElementSource|createElement\(['"]audio/);
  assert.doesNotMatch(source, /source\.connect\(this\.ctx\.destination\)/);
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
  const selectedTrackId = playlist.play()?.id;
  assert.ok(selectedTrackId);
  playlist.pause();
  assert.equal(playlist.isPlaying, false);
  assert.equal(playlist.play()?.id, selectedTrackId);
  assert.equal(playlist.isPlaying, true);
});

test('Web Audio playback cursor clamps offsets and preserves a finite pause position', () => {
  assert.equal(clampPlaybackOffset(-5, 120), 0);
  assert.equal(clampPlaybackOffset(30, 120), 30);
  assert.equal(clampPlaybackOffset(500, 120), 120);
  assert.equal(clampPlaybackOffset(Number.NaN, 120), 0);
  assert.equal(clampPlaybackOffset(20, Number.POSITIVE_INFINITY), 0);
  assert.equal(resolvePausedPlaybackOffset(12, 100, 108.5, 120), 20.5);
  assert.equal(resolvePausedPlaybackOffset(118, 100, 108.5, 120), 120);
});

test('only a natural current source end advances and stale loads cannot start', () => {
  assert.equal(shouldAutoAdvanceMusicSource(false, 7, 7), true);
  assert.equal(shouldAutoAdvanceMusicSource(true, 7, 7), false);
  assert.equal(shouldAutoAdvanceMusicSource(false, 6, 7), false);
  assert.equal(isCurrentMusicLoad(4, 4, 'track-b', 'track-b'), true);
  assert.equal(isCurrentMusicLoad(3, 4, 'track-b', 'track-b'), false);
  assert.equal(isCurrentMusicLoad(4, 4, 'track-a', 'track-b'), false);
});

test('failed tracks are skipped once and all failures activate procedural fallback', () => {
  const playlist = new MusicPlaylist(tracks, () => 0);
  playlist.setShuffle(false);
  assert.equal(playlist.play()?.id, 'a');
  assert.equal(playlist.markFailed('a')?.id, 'b');
  assert.equal(playlist.playableCount, 2);
  assert.equal(playlist.markFailed('b')?.id, 'c');
  assert.equal(playlist.markFailed('c'), null);
  assert.equal(playlist.playableCount, 0);
  assert.equal(playlist.next(), null);
  assert.equal(resolveMusicPlaybackMode(tracks, playlist.unavailableTrackIds), 'procedural');
  assert.equal(playlist.markFailed('c'), null, 'a repeated error must not retry a failed track');
});

test('shuffle-bag plays every available track once per cycle without a boundary repeat', () => {
  const playlist = new MusicPlaylist(MUSIC_TRACKS, () => 0);
  const firstCycle = [playlist.play()!.id];
  for (let index = 1; index < MUSIC_TRACKS.length; index++) firstCycle.push(playlist.next()!.id);
  assert.equal(new Set(firstCycle).size, MUSIC_TRACKS.length);
  assert.deepEqual(new Set(firstCycle), new Set(MUSIC_TRACKS.map(track => track.id)));

  const secondCycle = [playlist.next()!.id];
  assert.notEqual(secondCycle[0], firstCycle.at(-1));
  for (let index = 1; index < MUSIC_TRACKS.length; index++) secondCycle.push(playlist.next()!.id);
  assert.equal(new Set(secondCycle).size, MUSIC_TRACKS.length);
  assert.deepEqual(new Set(secondCycle), new Set(MUSIC_TRACKS.map(track => track.id)));
});

test('shuffle-bag removes a failed track from the current and future cycles', () => {
  const playlist = new MusicPlaylist(tracks, () => 0);
  playlist.play();
  playlist.markFailed('c');
  const heard = Array.from({ length: 8 }, () => playlist.next()!.id);
  assert.doesNotMatch(heard.join(','), /c/);
  assert.deepEqual(new Set(heard), new Set(['a', 'b']));
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
