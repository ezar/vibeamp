<h1 align="center">vibeamp</h1>

<p align="center">
  <strong>Tu música local, en un Winamp de verdad, con una cola que se ordena por cómo suena.</strong><br/>
  <em>Your local music, in a real Winamp, with a queue ordered by how it sounds.</em>
</p>

<p align="center">
  <a href="https://ezar.github.io/vibeamp/"><strong>Open vibeamp →</strong></a>
</p>

vibeamp points at a folder on your disk, listens to every track once, and then
builds queues by feel rather than by folder, artist or the genre an ID3 tag claims.
It wears a real Winamp 2.9 shell, loads real `.wsz` skins, and does all of it in the
browser.

**Everything runs on your machine. No account, no server, and no network at all once
the page has loaded.** Your files never move, and what is stored is a few numbers
per track.

---

## What it does

- **Listens to your library, once.** Tempo, key, loudness, brightness, how
  compressed the master is, and how danceable it is — measured from the audio, not
  read off a tag. Analysis is cached forever and keyed by the file's content, so
  renaming or moving a track does not throw it away.
- **Mixes like a DJ would.** Queues respect tempo continuity and harmonic mixing on
  the Camelot wheel, follow an energy curve you choose, and avoid repeating an
  artist, an album or something you heard an hour ago.
- **Gives you sliders that do something new.** Five vertical sliders in the Winamp
  idiom — energy, bright, dance, known, cohere — and letting one go reorders what is
  coming next. The track that is playing is never interrupted. Four presets set them
  all at once when you would rather not fiddle.
- **Shows you the queue, and why.** The next four tracks with their tempo and
  Camelot code, and one line for the move about to happen: `+6 bpm · 8B→8A
relative · energy +12`. Where it is not sure of a key it says so instead of
  inventing a reason.
- **Is a real Winamp.** The shell is [Webamp](https://webamp.org): three draggable,
  dockable windows, the ten-band equaliser on Winamp's own frequencies, the spectrum
  analyser, the hotkeys, and any `.wsz` skin you already have. Load one and it is
  kept, and it joins the shell's own skin menu. None ship with the app — classic
  skins belong to the people who made them. MilkDrop has a button in the vibe window
  and is fetched the first time you open it, so it costs nothing until you want it.
- **Reads and writes `.m3u`.** Load list and Save list in the playlist window do
  what they say. A loaded list is matched against your library by path, so the
  descriptors you already have come with it.
- **Lets you take your library with you.** Export the whole index, descriptors
  included, as one JSON file. Import it on another machine and nothing is analysed
  twice: tracks are matched by what is in them, not by where they are.
- **Is honest about what it knows.** Below 30 analysed tracks the auto-DJ turns
  itself off and says why, because a recommender with too little to go on produces
  queues that are obviously wrong. Descriptors measured before the library was big
  enough are marked provisional.
- **Stays out of the way while it works.** The playlist is playable before a single
  track has been analysed. Analysis runs in the background, one file at a time, and
  pauses itself on low battery or when the tab has been hidden for five minutes.

## What it is not

It does not stream, it has no catalogue, and it will not find you music you do not
already own. It is not a DJ tool: there is no beatmatching and no cue points. And it
does not diagnose your taste — every number it stores is a measurement of a
waveform, and the ones that are proxies say so.

## Getting started

```bash
pnpm install
pnpm verify     # format, lint, typecheck, tests
pnpm dev
```

Or run it yourself. Then choose **Open folder…** from the shell's menu and point it
at your music. `Ctrl`+`Shift`+`D` opens the debug panel, which shows where the analysis
time is going and what the playing track actually measured.

Chrome and Edge on the desktop are the target: they can remember the folder between
sessions. Firefox and Safari work through a fallback picker and ask for the folder
each time — the analysis is still found, because a track is identified by its
contents rather than by its path.

## How it fits together

```
apps/web/            the browser: shell, audio graph, storage, workers
packages/analysis/   window planning, the worker protocol, feature extraction
packages/dj/         energy curve, scoring, queue planning
packages/dsp/        FFT, spectra, onsets, tempo, chroma, key
packages/core/       domain types, the Camelot wheel, normalisation
```

The `packages/*` are free of the DOM, Web Audio, storage and WebAssembly, so the
signal processing and the queue planner run in Node and are tested there. The
descriptors are plain TypeScript with no native dependency — see
[decision 0002](docs/decisions/0002-descriptors-in-typescript.md) for why that is
not the obvious choice it looks like.

Full detail in [the specification](docs/specification.md), and the decisions that
departed from it in [docs/decisions](docs/decisions).

## Privacy

There is no backend. Nothing is uploaded, nothing is logged, and there is nothing to
opt out of. The app asks for persistent storage so the browser does not discard
hours of analysis under disk pressure, and for read access to the folder you choose.
That is the whole list.

## Licence

MIT. The shell is [Webamp](https://github.com/captbaritone/webamp), also MIT.
Winamp skins are the work of their authors and none are redistributed here.
