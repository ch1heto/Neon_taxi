export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  file: string;
  station: 'NEON FM';
}

export const NEON_FM_STATION = 'NEON FM' as const;

export const PROCEDURAL_NEON_FM_PROGRAM = Object.freeze({
  id: 'procedural-neon-drive',
  title: 'Neon Drive',
  artist: 'Neon Taxi',
  station: NEON_FM_STATION,
});

export type MusicPlaybackMode = 'playlist' | 'procedural';

export function resolveMusicPlaybackMode(tracks: readonly MusicTrack[]): MusicPlaybackMode {
  return tracks.length > 0 ? 'playlist' : 'procedural';
}

export function canMusicPlaybackRun(enabled: boolean, unlocked: boolean, lifecycleSuspended: boolean): boolean {
  return enabled && unlocked && !lifecycleSuspended;
}

/**
 * Only add tracks that are bundled in public/assets/music and cleared for use.
 * See public/assets/music/README.md for the required attribution/license notes.
 */
export const MUSIC_TRACKS: readonly MusicTrack[] = Object.freeze([]);
