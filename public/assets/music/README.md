# NEON FM music assets

This release bundles eight files from the supplied Neon Taxi music archives:

- `scott-buckley-machina.mp3` — **Machina**, Scott Buckley — CC BY 4.0
- `roa-music-pure.mp3` — **Pure**, Roa Music — CC BY 3.0
- `keys-of-moon-summer-evening.mp3` — **Summer Evening**, Keys of Moon — CC BY 4.0
- `ketsa-aimless.mp3` — **Aimless**, Ketsa — CC BY — Music by ketsa.uk
- `ketsa-cities.mp3` — **Cities**, Ketsa — CC BY — Music by ketsa.uk
- `ketsa-falling-sky.mp3` — **Falling Sky**, Ketsa — CC BY — Music by ketsa.uk
- `ketsa-internal-backchat.mp3` — **Internal Backchat**, Ketsa — CC BY — Music by ketsa.uk
- `ketsa-lighting-the-night.mp3` — **Lighting the Night**, Ketsa — CC BY — Music by ketsa.uk

Attribution is required for every track. The consolidated release record is
`/THIRD_PARTY_MUSIC_LICENSES.md`; the supplied provenance notes remain preserved in the
source repository at `docs/MUSIC_LICENSES.txt`. Retain the release record, project proof
notes, and in-game Music Credits when redistributing the game. The Ketsa pack records its
official licensing and album URLs.

NEON FM uses these local files through `src/audio/musicTracks.ts`. The built-in procedural
**Neon Drive** program remains a runtime fallback when the playlist is empty or all real
tracks fail to load; it is not an additional playlist entry.
