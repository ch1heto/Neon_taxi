# NEON FM music assets

This directory is intentionally empty. Neon Taxi does not download or bundle commercial music.

While the file manifest is empty, NEON FM automatically plays the built-in procedural
`Neon Drive` synthwave program. Adding at least one manifest entry switches playback to
the local-file playlist; the procedural program is not inserted as a fake playlist track.

Only add audio that is explicitly cleared for redistribution, such as:

- CC0 / public-domain recordings;
- original music owned by the project;
- royalty-free music whose license permits bundling in a web game.

For every added file, keep its title, author/source, license, and source URL in this README (even when attribution is optional), then add one matching entry to `src/audio/musicTracks.ts`:

```ts
{
  id: 'unique-track-id',
  title: 'Track title',
  artist: 'Artist',
  file: '/assets/music/track-file.ogg',
  station: 'NEON FM',
}
```

Prefer `.ogg` plus a broadly compatible encoded source when required by the release targets. Verify browser playback and the license before publishing.
