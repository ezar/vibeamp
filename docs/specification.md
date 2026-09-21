# vibeamp: technical specification

**Version 2 · 2026-09-20**

Version 1 of this document was written before any code existed. This version
records what was decided once the ground was tested: three of its choices changed,
and each change has a decision record in `docs/decisions/`.

## Summary

A local music player that runs entirely in the browser, offline, wearing a real
Winamp shell, with a recommendation engine that works without a cloud, an account
or external metadata.

You point it at a folder on your disk. It scans it, analyses each track once, and
stores the descriptors locally. From then on it builds queues by how music _sounds_,
not by folder, artist or the genre an ID3 tag claims.

### What makes it different

- **Streaming services** recommend by feel, but on a server, over their catalogue,
  not over your files.
- **DJ tools** — Mixed In Key, Rekordbox — compute BPM and key, but they are paid
  desktop preparation tools, not players.
- **Webamp** already solves the faithful Winamp clone in a browser. vibeamp does not
  compete with it. It _uses_ it: see decision 0001.

The gap is a player for a personal library that understands the content of the
audio, locally, free, with nothing to install.

### Design principles

- **Local first, absolutely.** No network calls during playback. The only bytes that
  leave the device are the initial download of the app itself.
- **Analysis is paid for once** per file and cached forever, indexed by content hash
  rather than by path.
- **Useful from the first minute.** Analysis runs in the background and every feature
  degrades gracefully while it is unfinished.
- **No server state.** There is no backend, and version 1 does not have one.

## Scope

### In version 1

- Pick a local folder; scan it recursively for audio.
- Read ID3 tags and embedded cover art.
- Play, with a playlist, manual ordering, repeat and shuffle.
- A working ten band equaliser with presets.
- Spectrum and oscilloscope visualisers.
- Background analysis of the whole library: tempo, key, loudness, energy,
  brightness, compression and danceability.
- Rule-based auto-DJ over those descriptors, with a configurable energy curve.
- Vibe sliders that replan the queue live.
- Full persistence in IndexedDB, including resuming analysis after the tab is closed.
- Real `.wsz` skin support, which comes with the shell.
- MilkDrop visualisation, loaded on demand so it costs nothing until it is opened.
- Reading and writing `.m3u` playlists.

### Explicitly out of version 1

- CLAP, embeddings and free-text search. Version 2; version 1 leaves room for it.
- A backend, user accounts, sync between devices.
- Streaming, online radio, third-party services.
- ID3 tag editing.
- True gapless playback and silence-aware crossfading. Version 1 crossfades on a
  linear ramp.
- Exotic formats. Version 1 relies on what the browser decodes natively and marks
  the rest unsupported.

## Architecture

Four layers, with one hard rule: **the main thread decodes and plays; everything
expensive lives in a worker or in a pure function.**

```
apps/web/            the browser: Webamp shell, audio graph, storage, workers
packages/analysis/   window planning, the worker protocol, feature extraction
packages/dj/         energy curve, scoring, queue planning
packages/dsp/        FFT, spectra, onsets, tempo, chroma, key
packages/core/       domain types, the Camelot wheel, normalisation
```

`packages/*` are free of the DOM, Web Audio, storage and WebAssembly. They run in
Node, which is why 150 of the project's tests need no browser at all.

### The shell

Webamp (MIT, no runtime dependencies) provides the Winamp 2.9 shell: the three
windows and their docking, `.wsz` skins, the hotkeys, the visualiser and the
playlist. vibeamp supplies what is underneath it through two extension points.

- `__customMediaClass` replaces Webamp's audio engine with `VibeampMedia`.
- `filePickers` adds "Open folder…" to the shell's own menu.
- `__butterchurnOptions` loads MilkDrop, through a dynamic import so the visualiser
  and its presets stay out of the first load. They are two chunks of about 200 KB
  each, fetched the first time the window is opened, and the base bundle is
  unchanged. Both packages predate modules, so neither import is the shape it
  looks like: butterchurn hides behind `default`, and the preset pack's default
  export is a class whose static `getPresets()` returns the map. Reading it as a
  map yields no presets and butterchurn falls back to one fixed pattern, which
  looks like a working visualiser — the first version of this shipped that way for
  a day. `presets.test.ts` imports the real package rather than a mock, because a
  mock would only assert that the code agrees with the assumption that was wrong.
- `windowLayout` places the windows. Left to itself Webamp opens MilkDrop at the
  main window's own position, so the visualiser lands on top of the transport, the
  track title and the seek bar. The layout states the arrangement instead: the three
  classic windows stacked, MilkDrop docked against the stack's right edge and eight
  resize rows tall, which is exactly the height of the three it sits beside.

Those positions are offsets inside a box that Webamp then centres in its container,
not viewport coordinates — so the vibe window, which is not Webamp's, cannot be
placed the same way. It is positioned against the main window's measured rectangle
once the shell has rendered.

### On a phone

Below 700px there is no room for two columns, and the desktop arrangement put the
vibe panel on top of the main window: the transport, the title and the seek bar were
all behind it, and the page could not scroll to what was underneath. The app was not
merely cramped there, it was unusable.

The phone layout is one column. The shell opens with the player and the playlist
only — ten equaliser bands at 275px is a row of targets nobody can hit, and it costs
a third of the screen before the player has said what is playing; it is still one
tap away in the shell's own menu. The panel follows as an ordinary block under the
shell, centred on it so the two read as one column rather than two applications that
happened to load together.

Two things are deliberately **not** done. The panel is not stretched to the gutters:
Webamp's windows are a fixed 275px whatever the screen, and a full-width panel under
a narrow player looks like a mistake. And the shell is not scaled up to fill the
width, which would look better but breaks Webamp's own drag arithmetic, since it
reads pointer coordinates that a CSS transform does not correct.

Placement on a phone belongs to the stylesheet rather than to a measurement. Flow
puts the panel under the shell and grows the page to hold it; doing it in JavaScript
would mean measuring the shell, then measuring the panel again to give the page
something to scroll to, and watching both for changes. The breakpoint is therefore
carried in three places — `NARROW_MAX_WIDTH`, `app.css` and `vibe.css` — with a test
asserting the constant rather than trusting the three to stay in step.

The shell subscribes to six events — `timeupdate`, `ended`, `playing`, `waiting`,
`stopWaiting`, `fileLoaded` — and drives the engine through its `IMedia` interface.
Both were read off the published bundle, not guessed.

### The audio graph

```
deck A <audio> -> source -> deck gain -\
                                        >- headroom -> preamp -> EQ x10
deck B <audio> -> source -> deck gain -/                            |
                                                                    v
  destination <- master gain <- analyser <- balance (split/merge) <--+
```

Two decks, so a track can crossfade into the next. `<audio>` with
`createMediaElementSource` rather than `AudioBufferSourceNode`: it streams from a
`File` through an object URL without loading the track into memory, and brings
`currentTime`, seeking and buffering with it. The cost is sample-exact control,
which a player does not need.

The ten bands are Winamp's own — 60, 170, 310, 600, 1k, 3k, 6k, 12k, 14k and 16k Hz
— which is exactly the set Webamp's slider type declares, so nothing has to be
translated. Every gain change is ramped with `setTargetAtTime`, never assigned, or
dragging a slider clicks.

The **headroom** gain is the one thing Webamp's own engine does not do: ten bands
boosted by 12 dB is a great deal of gain, and without backing it out the output
clips before the master fader can help.

### Data flow: analysis

```
Folder (FileSystemDirectoryHandle, or a directory input)
  -> scan: files, in batches, yielding the thread between them
  -> content hash (SHA-256 of the first MiB + the size)
  -> already in IndexedDB at the current ANALYSIS_VERSION?
       yes -> nothing to do
       no  -> pending
  -> wait for a free worker          <- the back pressure lives here
  -> decode (main thread, OfflineAudioContext at 16 kHz mono)
  -> transfer the Float32Array to the worker
  -> worker: plan windows, extract descriptors, post the result
  -> library: normalise against the library, write, emit progress
```

Waiting for a worker **before** decoding is not an optimisation. A five minute
track is about 19 MB of `Float32Array` at the analysis rate; a decoder running ahead
of the workers accumulates them until the browser kills the tab.

### Data flow: the queue

```
Seed (the playing track) and the vibe target
  -> hard filter: only tracks with a complete analysis
  -> score each candidate against the target and against the current track
  -> repetition penalties (artist, album, recent history, familiarity)
  -> best twelve, drawn with a weighted roll so the session is not deterministic
  -> the plan, held outside the shell
  -> two tracks at a time handed to the playlist
```

The plan is rebuilt only from the next track onwards. What is playing is never
touched.

### Why there is no backend

No operation needs a server. The files are on the user's disk, the analysis runs on
their CPU and the index lives in their browser. A backend would add hosting,
privacy to manage, and a reason for the project to die when someone stops paying for
it.

## Stack

Matching the conventions of the sibling projects:

- **pnpm workspaces**, with DOM-free engine packages and one app.
- **TypeScript, strict**, with project references. No `any` at any boundary.
- **React 19 + Vite 8**, `vite-plugin-pwa` for the installable build.
- **Dexie** over IndexedDB.
- **zustand** for the small amount of interface state.
- **Vitest** for unit tests, **fake-indexeddb** for the storage layer.
- **eslint** flat config and **prettier**, run together as `pnpm verify`.
- **Webamp** for the shell.
- **music-metadata** for tags.

### Rejected, and why

- **Essentia.js** for the descriptors, which version 1 of this document specified.
  It is AGPL-3.0, ships no type definitions, and has not been published since 2021.
  See decision 0002: the descriptors are implemented here instead.
- **Blazor WebAssembly.** The equaliser and the visualiser live in Web Audio and on
  a canvas at 60 fps, and with Blazor all of that crosses JS interop every frame.
  The cost buys nothing, because there is no server logic to reuse.
- **Meyda** for feature extraction. A good library, but it has no key or tempo
  detection, which is most of what this project needs.
- **Electron or Tauri from the start.** Packaging can come later. Starting on the web
  forces the browser's limits to be solved properly, which is where the technical
  interest is.

## Data model

An IndexedDB database named `vibeamp`, version 1. Audio is never stored: only
handles, tags and descriptors, at roughly two kilobytes a track.

| Store         | Key                 | Indexes                                                              |
| ------------- | ------------------- | -------------------------------------------------------------------- |
| `roots`       | `id`                | —                                                                    |
| `tracks`      | `id` (content hash) | `status`, `rootId`, `meta.artist`, `analysis.bpm`, `analysis.energy` |
| `playHistory` | auto                | `trackId`, `playedAt`                                                |
| `settings`    | `key`               | —                                                                    |

### Identity by content

A track's `id` is `sha-256(first MiB + ':' + size)`. Renaming or moving a file does
not trigger re-analysis, and the same file in two folders is recognised as one
track. Only the first mebibyte is hashed because hashing whole files costs minutes
on a large library, for a collision risk that does not exist in practice.

### Descriptors

```ts
interface TrackAnalysis {
  bpm: number; // 40..220, or 0 when no pulse was found
  bpmConfidence: number; // 0..1
  key: KeyEstimate; // root, scale, strength, margin, Camelot code
  loudnessDb: number; // dBFS, negative
  energy: number; // 0..1, a percentile of this library
  brightness: number; // 0..1, a percentile of this library
  compression: number; // 0..1, 1 is brickwalled
  danceability: number; // 0..1, a percentile of this library
  provisional: boolean; // the library was too small for percentiles
  inputs: NormalisationInputs;
  windows: WindowFeatures[];
}
```

Every 0..1 value is a **percentile within the user's own library**, not an
absolute. Mastered techno and close-miked jazz do not share a scale of loudness or
of brightness, and a fixed one puts every track in either collection at the same end
of the slider.

The distribution is kept as a hundred-bucket histogram per descriptor: a few hundred
bytes, constant-time updates, accurate to one percentile. Below fifty analysed
tracks the fixed ranges are used instead and the result is marked `provisional`;
crossing that threshold re-ranks everything in one pass.

`inputs` holds the raw values each percentile was computed from, so re-ranking is
exact. Deriving them back out of the percentiles is lossy, and the loss compounds.

**`compression`, not `dynamics`.** It counts how squashed the master is. The obvious
name reads as dynamic range and would mean the opposite of the number stored.

### Versioning

`ANALYSIS_VERSION` is a constant. At start-up the library marks every track analysed
by an older version as pending. The pipeline can improve without a rescan and
without discarding tags or history; the old descriptors stay readable until better
ones replace them, so the player keeps working throughout.

## The descriptors

All of it is plain TypeScript with no native dependency, which removes the largest
technical risk version 1 of this document identified — WebAssembly heap management —
by removing the WebAssembly. See decision 0002.

| Descriptor   | Method                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Tempo        | Onset envelope, autocorrelation, harmonic comb at fractional lags, sub-multiple penalty, log-normal prior at 120 BPM |
| Key          | Chroma folded onto twelve pitch classes, correlated against Krumhansl-Kessler profiles for all 24 keys               |
| Loudness     | RMS over the analysed windows, in dBFS                                                                               |
| Brightness   | Spectral centroid                                                                                                    |
| Compression  | Crest factor, inverted                                                                                               |
| Danceability | A documented **proxy**: pulse clarity, low-band weight and onset density                                             |

### Tempo, and the octave problem

A track filed at half its real tempo puts a jump into every transition it takes
part in, so three things guard against it:

- **Fractional lags.** At a 100 Hz envelope rate, 174 BPM is a period of 34.48
  frames. A comb restricted to whole frames lines up better with 69 — half the
  tempo, and very nearly exact — than with 34. That alone reports half tempo, and it
  is what the first implementation here did.
- **A sub-multiple penalty.** If the envelope also correlates at half a candidate's
  period, there are beats in between the candidate's, and the faster pulse is the
  beat. A comb alone cannot see this: every multiple of the true period scores well.
- **Confidence gated on peakiness.** A sustained tone produces a tiny but perfectly
  periodic envelope ripple, from the interaction of the hop size with the tone's
  phase. It autocorrelates beautifully at a lag that has nothing to do with music.
  Periodicity alone therefore reports a confident tempo for a drone.

Measured on generated click tracks: correct within one per cent from 60 to 174 BPM,
with confidence above 0.85. White noise scores 0.16 and a sustained tone 0.08, both
well below the 0.3 the queue treats as usable.

### Danceability is a proxy, and says so

This is **not** Essentia's `Danceability`, which uses detrended fluctuation analysis.
It is a composite of pulse clarity, low-band energy share and onset density,
multiplied rather than averaged because a track needs all three. It is named a proxy
in its own documentation, in the specification, and wherever it is surfaced.

### Windows

Three ten second windows at 15, 50 and 80 per cent of the duration. This skips the
intro and the fade, covers what characterises the track, and costs a fraction of the
whole. Tracks under 35 seconds are analysed whole; under 3 seconds they are marked
unsupported, because they are a sound effect or a truncated file.

Tempo is the exception and takes a single 30 second window from 25 per cent: every
tempo estimator needs sustained rhythmic context, and three stitched excerpts have
two discontinuities in them that an autocorrelation reads as evidence.

## The worker protocol

The constraint that shapes it: **`decodeAudioData` is not available in a worker.**
Decoding happens on the main thread and what crosses is a decoded `Float32Array`,
transferred rather than copied.

So the worker never touches a file, never touches the database, and does not know
what a track is. It receives samples and returns numbers.

```ts
type ToWorker =
  | { type: 'init'; payload: { analysisVersion: number } }
  | { type: 'analyze'; payload: AnalyzeRequest }
  | { type: 'cancel'; payload: { jobId: string } }
  | { type: 'dispose' };

type FromWorker =
  | { type: 'ready'; payload: { analysisVersion: number } }
  | { type: 'progress'; payload: { jobId: string; stage: Stage; pct: number } }
  | { type: 'result'; payload: { jobId: string; features: RawFeatures } }
  | { type: 'error'; payload: WorkerError };
```

Rules:

1. A worker answers `ready` once, and is sent no work before it does.
2. One `analyze` at a time per worker. The pool never queues two in the same worker.
3. `cancel` for a finished job is ignored silently.
4. Cancelling does not interrupt work in progress: the descriptors are synchronous
   loops, so the flag is checked between stages and the pipeline stops at the next
   boundary.
5. `fatal: true` means the worker is in an undefined state. The pool terminates it
   and creates a new one.
6. Sixty seconds without an answer and the worker is terminated without waiting.

Error codes are `bad_input`, `too_short`, `algorithm` and `cancelled`. There is no
`wasm_init` or `oom`: there is no WebAssembly heap to fail to initialise or exhaust.

## Concurrency and performance

The bottleneck is **decoding**, and it is on the main thread because there is
nowhere else. Mitigation: decode one file at a time and yield between them. An
analysis that takes twenty minutes with a responsive interface is better than one
that takes eight with a stuttering one.

- Analysis workers: `min(4, max(1, hardwareConcurrency - 1))`.
- Simultaneous decodes: 1.
- Buffers in flight: at most one per worker, enforced by waiting for a slot first.

Analysis pauses by itself when the battery is below 20 per cent and not charging,
and when the tab has been hidden for more than five minutes.

### Targets

|                                               | Target                          |
| --------------------------------------------- | ------------------------------- |
| Analysis, per track, mid-range laptop         | under 1.5 s including decode    |
| A 5,000 track library                         | under 2 hours in the background |
| Queue computation, 20,000 candidates          | under 100 ms                    |
| Interface with the visualiser running         | 60 fps                          |
| Cold start to first playback, library indexed | under 2 s                       |

The queue target is asserted in the test suite. The rest need a real library and a
real machine, and are checked with the debug panel rather than claimed here.

## The auto-DJ

### The Camelot wheel

A code is a number from 1 to 12 and a letter (`A` minor, `B` major). Two tracks sit
well together when they share a code, differ by one step with the same letter, or
are a relative major and minor pair. The full 24-key table is written out in
`packages/core/src/camelot.ts` and asserted row by row: an error in one row is
invisible in the app and quietly wrong in every queue it builds.

Notes are always named with sharps. `@vibeamp/dsp` normalises them that way, so
nothing downstream has to know about enharmonics.

| Distance | Meaning                                       |
| -------- | --------------------------------------------- |
| 0        | The same key                                  |
| 0.15     | The relative major or minor                   |
| 0.25     | One step around the wheel, same mode          |
| 0.55     | Two steps, same mode                          |
| 1        | A clash, or a key that could not be estimated |

An unknown key scores as a clash rather than as a match. Scoring it as a match makes
unanalysed tracks beat analysed ones, and the queue fills with the tracks it knows
least about.

### The energy curve

The queue is a walk along a target curve, not a flat list. `flat` holds, `rise`
builds, `winddown` descends and `arc` — the default — climbs, plateaus and comes
back down.

The curve starts where **the sliders** say, not where the seed happens to be. The UI
initialises the energy slider from the playing track, so leaving it alone already
means "carry on from here". Reading the base off the seed instead makes the energy
slider inert for a flat curve, which is the shape it is most often used with.

### Scoring

Everything is a cost and the lowest wins.

| Term    | Weight | Notes                                                                 |
| ------- | ------ | --------------------------------------------------------------------- |
| Tempo   | 0.25   | 8 per cent relative tolerance; half and double time count as matches  |
| Key     | 0.20   | Camelot distance                                                      |
| Energy  | 0.30   | Distance from the curve's target at this position                     |
| Timbre  | 0.15   | 0.6 brightness, 0.4 danceability                                      |
| Novelty | 0.10   | Recent artist, album, play; plus distance from the familiarity target |

The tempo term fades towards neutral as confidence drops, rather than being trusted
or discarded. The **coherence** slider moves weight between tempo and key on one
side and the vibe target and variety on the other, holding the total constant so
costs stay comparable as it moves.

### Selection

1. Keep only tracks with a complete analysis.
2. Drop what was played in the last four hours and what is already queued.
3. Above 2,000 candidates, prefilter to ±15 per cent tempo before scoring, falling
   back to the whole pool when that is too tight to fill a shortlist.
4. Take the best twelve by partial selection, not by sorting the library.
5. Draw one with probability proportional to `1 / (cost + 0.05)`, so the same seed
   does not always give the same session.
6. Keep 20 planned, recomputing the energy target at each step.

### Degradation

Below 30 analysed tracks the auto-DJ is disabled and the interface shows analysis
progress in its place, saying why. A recommender with too little to go on produces
obviously bad queues, and the user concludes the feature does not work rather than
that it is not ready.

## The interface

The shell is Webamp's: three windows, docking, skins, hotkeys, the visualiser.

MilkDrop has a button in the vibe window. The shell has its own entry for it, three
levels into the Options menu, which is the same place "Open folder" was when nobody
could find that either. It stays closed on arrival — the point of this player is the
queue, and a visualiser nobody asked for is 400 KB and a WebGL context — but opening
it is now one press. The button toggles `TOGGLE_WINDOW` on Webamp's own store, so
closing the window from its title bar leaves nothing to keep in sync.

### The vibe window

Five vertical sliders in the Winamp idiom — energy, brightness, danceability,
familiarity and coherence — in a window of their own, draggable by its title bar.
Version 1 of this document put them in a second tab of the equaliser window; Webamp
owns its own DOM and has no slot for one. See decision 0003.

It is drawn and placed as one of Winamp's own windows rather than as a panel put
next to one: exactly 275px wide including its borders, docked edge to edge against
the shell with no gap, and carrying Winamp's title bar — the name centred between
two runs of horizontal lines. A gap and a different header were enough to make it
read as a card that happened to load beside the player, which on a phone, where the
column is all there is, looked like two applications stacked on top of each other.

The title bar is drawn, not skinned, for the same reason the rest of the window is:
Webamp does not expose the `.wsz` it parsed. Against the default skin the two are
close enough to read as one instrument. Against a loaded skin this window still
keeps its own colours, which is the cost decision 0003 already accepted.

Releasing a slider replans; moving it does not. Planning reads the whole analysed
library, and doing that on every pixel of a drag turns one gesture into a few
hundred passes over it.

The playing track is never interrupted. This is the demonstration moment of the
product: move a slider from 1997 and watch the queue reorder itself.

Four presets — warm, peak, dig, late — set every slider and the curve together,
because the two only mean something in combination: a high energy target on a
wind-down curve is not "peak time", it is a contradiction. They are starting
points, not modes: nothing is remembered and no preset stays selected.

### A vibe in a link

The five sliders and the curve are the whole of what the planner is told, and none
of it names a track: they are positions on percentiles that each library computes
for itself. So the same six numbers mean "loud for this collection, bright for this
collection" wherever they land, and a link can carry a setting from one person's
records to another's without carrying any music. It needs no server, which is why
it is the one thing this player can share at all.

Twelve characters: a version, five bytes of slider, one digit of curve. A byte is
about a third of a percent of fader travel, finer than anyone can set a 64 pixel
control. Versioned because the sliders are the product and will change, and a link
from an older release must be **refused** rather than misread — five values decoded
into six sliders is not an error a listener would notice, it is a queue that
reorders for no stated reason.

The link is read before the first render rather than in an effect, so the faders are
already in place when the window appears. A page opened with one says so, once.

### The queue, and why

The plan is twenty tracks deep and the shell only ever holds two of them, so until
version 1.1 the recommender was invisible: the queue reordered on a slider move and
nothing on screen said so. The window now lists the next four, each with the tempo
and the Camelot code the transition turns on, and one line describing the move about
to happen — `+6 bpm · 8B→8A relative · energy +12`.

The line is re-derived from the two tracks rather than read off the planner's cost,
because a single number is not an explanation. Only the imminent transition is
described: the ones after it were planned from a target the listener is still
moving, and describing them would be a promise the next slider release breaks.

Where an estimate is not trusted the line says so rather than inventing a relation.
The key cost is already faded out below `KEY_STRENGTH_FLOOR`, and reporting
"relative minor" from an estimate the planner ignores would be a lie with a number
attached.

### While analysing

The playlist is populated and playable before a single track has been analysed. The
vibe window shows what is being analysed, how many remain, and why it has paused if
it has. The app has to be useful in its first minute, not after its first hour.

## Platform limits

### File System Access

`showDirectoryPicker` returns a handle that survives a reload, **but the permission
does not**, and `requestPermission` only works inside a user gesture. So the app
always starts behind a connect button rather than reading files on load. The index
and the descriptors are available without permission, so the library can be browsed
and a queue planned before anything can be played.

| Browser              | Support                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome, Edge desktop | Full. The target platform.                                                                                                                                                                                                 |
| Firefox              | No File System Access. Falls back to `<input webkitdirectory>`; the folder is re-picked each session, and cached analysis still applies because identity is a content hash.                                                |
| Safari desktop       | The same fallback.                                                                                                                                                                                                         |
| iOS                  | No File System Access, and serious limits on background audio. It works as a player for a one-off selection, not as a library. The layout is built and tested for a phone; iOS's own limits are documented, not disguised. |

### Storage

`navigator.storage.persist()` is requested at start-up. Without it the browser may
evict IndexedDB under disk pressure, and the user loses hours of analysis they
cannot see. At about 2 KB a track, 20,000 tracks fit in well under 100 MB.

### Bundle

The published Webamp bundle carries its own copy of React, so the app ships two.
The production bundle is about 1.4 MB, 440 KB compressed. Acceptable for something
installed once as a PWA and then run offline, and worth measuring against
`webamp/lazy` before version 1 ships.

## Still open

### Two of the shell's alerts cannot be reached properly

Five of Webamp's menu entries fall back to a browser `alert` reading _"Not supported
in Webamp"_, which names the wrong product at somebody using this one. Three of them
take a handler option and are answered properly: Load list and Save list read and
write `.m3u`, and Add URL says that this player has nothing to fetch.

The other two — Playlist → Remove misc and Playlist → File info — call `alert()`
inline, with no option to pass. `createHost` takes the alert away for the width of
the click and shows the notice in the vibe window instead. It works, and an e2e test
holds it, but it reads the shell's own class names: a Webamp release that renames
`.remove-misc` or `.file-info` puts both alerts back. Doing better means either a
patch upstream or a fork, and neither is worth it for two menu entries.

### The eject button bypasses the library

It calls Webamp's own file picker, so tracks are added straight to the playlist
without passing through the scanner: they play, but are never hashed or analysed,
and the auto-DJ stays at zero. Redirecting it means intercepting a minified Redux
action, which breaks on every Webamp release, so it is left alone. The answer was
to make the real entry point impossible to miss instead.

### Measured against a real library

Cold start, analysis throughput, heap behaviour over a thousand tracks, and whether
the visualiser really stops when the tab is hidden. All of it needs a real library
and a real machine, and none of it is claimed here.

## Acceptance criteria

Version 1 is finished when all of the following hold. The state of each is recorded
honestly.

| #   | Criterion                                                           | State                                           |
| --- | ------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | A 1,000 track folder listed in under 30 s                           | Needs a real library                            |
| 2   | Play, pause, seek and skip with no audible clicks                   | Needs listening                                 |
| 2b  | Crossfade between consecutive tracks                                | **Covered by tests**; the sound needs listening |
| 3   | Moving an equaliser band is audible at once, with no artefacts      | Ramped, needs listening                         |
| 4   | Analysis resumes exactly where it stopped after a reload            | **Covered by tests**                            |
| 5   | A renamed file is not re-analysed                                   | **Covered by tests**                            |
| 6   | Auto-DJ returns 20 tracks from 20,000 in under 100 ms               | **Covered by tests**                            |
| 7   | Consecutive tempos within 10 per cent in 80 per cent of transitions | **Covered by tests**                            |
| 8   | The energy slider audibly reorders the queue                        | **Covered end to end**                          |
| 9   | The visualiser stops when the tab is hidden                         | Webamp's, needs profiling                       |
| 10  | Analysing 1,000 tracks does not grow the heap monotonically         | Needs a real library                            |
| 11  | Works in Firefox through the fallback picker                        | Implemented, needs Firefox                      |
| 12  | Installed as a PWA, starts with no network                          | Built, needs verifying                          |

### Build order

1. ~~A minimal player: folder, list, playback.~~
2. ~~Persistence: IndexedDB, hashing, reconnection.~~
3. ~~The audio graph: equaliser, visualiser, crossfade.~~
4. ~~The analysis pipeline end to end.~~
5. ~~The remaining descriptors and normalisation.~~
6. ~~The auto-DJ and the vibe sliders.~~
7. ~~The shell and skins — Webamp's, so mostly choosing defaults.~~
8. ~~PWA, export and import, the debug panel.~~

Version 1 of this document called step 4 the highest technical risk, and it was
right to: the tempo estimator needed three separate corrections before it stopped
reporting half tempo, and each was found by a test rather than by reading the code.
Removing WebAssembly removed the other half of that risk.

## Skins, export and the debug panel

### Skins

The user brings their own `.wsz`. None ship with the app: classic skins are the work
of their authors and redistributing them is not ours to do, and the shell loads any
of them, so there is no reason to. A skin is copied into IndexedDB when it is picked
— a `File` is a handle onto something on disk, and the user is free to move it a
moment later — and appears in the shell's own skin menu on the next start, because
`availableSkins` is fixed when the shell is constructed.

### Export and import

The whole index as JSON: tracks, descriptors, the values the percentiles were
computed from, and the play history. No audio, and no folder handles, which mean
nothing on another machine.

Coming back in, tracks are matched by content hash, so an export taken on one
computer lands correctly on another where every path is different. **Paths are not
taken from the export**: a track already here keeps the location it has on this
machine, and only its analysis can be replaced — by a newer pipeline version, or by
an analysis where there was none. Play events are matched on track and timestamp, so
importing the same file twice does not double every play count and skew the
familiarity slider.

Afterwards the distribution is **rebuilt** from every stored analysis rather than
adjusted. Merging two libraries' histograms would be adding counts of different
tracks together, producing a scale that describes neither.

### The debug panel

Behind Ctrl+Shift+D, because it is for whoever is tuning the engine rather than for
whoever is listening. It shows where the analysis time goes (mean per stage, decode
time, end-to-end per track), what failed and why, and the descriptors of the playing
track — which is what decides whether a bad queue is the scoring's fault or the
descriptors'.

Stage timings are per job, because four workers run at once and one shared timer
would report whatever the last worker happened to do.

**The shortcut is captured and swallowed.** Winamp binds Ctrl+D to double size and
the shell matches it without looking at Shift, so the obvious listener opened the
panel and doubled the player at the same time. Any shortcut added here has to be
checked against the shell's, and that check is an end-to-end test.

### Updates

The service worker precaches the whole app, so a new version is **offered**, not
applied: activating one under a running session risks serving a new page against an
old chunk, and the session it would interrupt is someone listening to music.

## Version 2: semantic search

CLAP projects audio and text into the same vector space, and is available in
`transformers.js` as `Xenova/clap-htsat-unfused`, giving 512-dimension embeddings.
That buys two things no local player has: **search by description** ("something
melancholy and slow for coding at night") and **more like this one**, which captures
timbre and atmosphere far better than any combination of numeric descriptors.

What it implies:

- A second worker pool, because the model is much larger than the descriptors and
  should be switchable off.
- `TrackAnalysis` gains a `Float32Array` of 512, stored as a typed array rather than
  as JSON, which is five times smaller.
- The three windows' embeddings are averaged and normalised to unit length, so
  cosine similarity is a dot product.
- `ANALYSIS_VERSION` becomes 2, and tracks are re-analysed **only** for the
  embedding. The pipeline should support partial analysis from the start.
- Brute force search: 20,000 × 512 is 40 MB and a full dot product takes tens of
  milliseconds. A vector index would be over-engineering.

**Measure the cost per track before committing.** Above about five seconds on a
normal laptop it has to be opt-in and on demand — "analyse this folder in depth" —
rather than applied to the whole library.
