export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  file: string;
  station: 'NEON FM';
}

export interface MusicCredit {
  title: string;
  artist: string;
  license: 'CC BY' | 'CC BY 3.0' | 'CC BY 4.0';
  attribution?: string;
}

export const NEON_FM_STATION = 'NEON FM' as const;

export const PROCEDURAL_NEON_FM_PROGRAM = Object.freeze({
  id: 'procedural-neon-drive',
  title: 'Neon Drive',
  artist: 'Neon Taxi',
  station: NEON_FM_STATION,
});

export type MusicPlaybackMode = 'playlist' | 'procedural';

export function resolveMusicPlaybackMode(
  tracks: readonly MusicTrack[],
  unavailableTrackIds: ReadonlySet<string> = new Set(),
): MusicPlaybackMode {
  return tracks.some(track => !unavailableTrackIds.has(track.id)) ? 'playlist' : 'procedural';
}

export function canMusicPlaybackRun(enabled: boolean, unlocked: boolean, lifecycleSuspended: boolean): boolean {
  return enabled && unlocked && !lifecycleSuspended;
}

/**
 * Only add tracks that are bundled in public/assets/music and cleared for use.
 * See public/assets/music/README.md for the required attribution/license notes.
 */
export const MUSIC_TRACKS: readonly MusicTrack[] = Object.freeze([
  Object.freeze({
    id: 'scott-buckley-machina',
    title: 'Machina',
    artist: 'Scott Buckley',
    file: '/assets/music/scott-buckley-machina.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'roa-music-pure',
    title: 'Pure',
    artist: 'Roa Music',
    file: '/assets/music/roa-music-pure.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'keys-of-moon-summer-evening',
    title: 'Summer Evening',
    artist: 'Keys of Moon',
    file: '/assets/music/keys-of-moon-summer-evening.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'ketsa-aimless',
    title: 'Aimless',
    artist: 'Ketsa',
    file: '/assets/music/ketsa-aimless.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'ketsa-cities',
    title: 'Cities',
    artist: 'Ketsa',
    file: '/assets/music/ketsa-cities.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'ketsa-falling-sky',
    title: 'Falling Sky',
    artist: 'Ketsa',
    file: '/assets/music/ketsa-falling-sky.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'ketsa-internal-backchat',
    title: 'Internal Backchat',
    artist: 'Ketsa',
    file: '/assets/music/ketsa-internal-backchat.mp3',
    station: NEON_FM_STATION,
  }),
  Object.freeze({
    id: 'ketsa-lighting-the-night',
    title: 'Lighting the Night',
    artist: 'Ketsa',
    file: '/assets/music/ketsa-lighting-the-night.mp3',
    station: NEON_FM_STATION,
  }),
]);

export const MUSIC_CREDITS: readonly Readonly<MusicCredit>[] = Object.freeze([
  Object.freeze({ title: 'Machina', artist: 'Scott Buckley', license: 'CC BY 4.0' }),
  Object.freeze({ title: 'Pure', artist: 'Roa Music', license: 'CC BY 3.0' }),
  Object.freeze({ title: 'Summer Evening', artist: 'Keys of Moon', license: 'CC BY 4.0' }),
  Object.freeze({ title: 'Aimless', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' }),
  Object.freeze({ title: 'Cities', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' }),
  Object.freeze({ title: 'Falling Sky', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' }),
  Object.freeze({ title: 'Internal Backchat', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' }),
  Object.freeze({ title: 'Lighting the Night', artist: 'Ketsa', license: 'CC BY', attribution: 'Music by ketsa.uk' }),
]);
