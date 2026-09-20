# 1. Webamp is the shell, and we keep the engine

**Status:** accepted · **Date:** 2026-09-20

## Context

The first specification treated the Winamp look as an envelope to be built: an own
sprite-sheet skin format, an own equaliser, an own visualiser, an own window
manager. It explicitly declined to compete with Webamp, then specified rebuilding
most of what Webamp is.

Reading Webamp's published package changed the picture:

- MIT licensed, no runtime dependencies.
- A faithful Winamp 2.9, with **real `.wsz` skin support**, window docking, the
  hotkeys, double-size mode, the Media Session API and Butterchurn as an option.
- Its `Band` type is `60 | 170 | 310 | 600 | 1000 | 3000 | 6000 | 12000 | 14000 |
16000` — literally the band list the specification prescribed.
- `__customMediaClass` accepts a replacement audio engine.
- `filePickers` accepts an entry in the shell's own menu.

Building our own shell would have taken most of the project's time and produced
something less faithful than the thing we would have been avoiding.

## Decision

Depend on `webamp`, and supply what is genuinely ours through its extension points.

Ours: the descriptors, the queue, the library, and the audio engine underneath —
`VibeampMedia`, which adds two decks for crossfading and a headroom gain so ten
boosted bands cannot clip.

Theirs: the windows, the skins, the playlist, the visualiser, the hotkeys.

Its `IMedia` contract is honoured exactly, including the six events its store
subscribes to. Those were read off the published bundle rather than guessed; they
are `timeupdate`, `ended`, `playing`, `waiting`, `stopWaiting` and `fileLoaded`,
and a missing one shows up as a frozen time display or a playlist that never
advances.

## Consequences

- The skin question disappears. `.wsz` skins work, so there is no format to invent
  and no redistribution problem to reason about: the user brings their own.
- Two React copies ship, because the published bundle carries its own. About 1.4 MB,
  440 KB compressed. Worth measuring against `webamp/lazy` before release.
- Two constraints follow from not owning the shell, each with its own record: the
  vibe sliders cannot live inside the equaliser window (0003), and the playlist tail
  cannot be rewritten (0004).
- Tracks are handed over as URL tracks over object URLs **this app creates**, not as
  blob tracks. Webamp reports a track change by URL, and a URL it made itself cannot
  be mapped back to one of our tracks.
- If the shell ever has to be modified rather than extended, the fork is available
  and the boundary is already drawn at `IMedia`.
