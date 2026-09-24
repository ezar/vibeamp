<h1 align="center">vibeamp</h1>

<p align="center">
  <strong>Tu música local, con la interfaz de Winamp, y una cola que se ordena por cómo suena.</strong><br/>
  <em>Your local music, wearing Winamp's interface, with a queue ordered by how it sounds.</em>
</p>

<p align="center">
  <a href="https://ezar.github.io/vibeamp/"><strong>Open vibeamp →</strong></a>
</p>

vibeamp points at a folder on your disk, listens to every track once, and then
builds queues by feel rather than by folder, artist or the genre an ID3 tag claims.
It wears the Winamp 2.9 interface, loads real `.wsz` skins, and does all of it in the
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
- **Lets you share a vibe, not a playlist.** One button copies a link carrying the
  five sliders and the curve — twelve characters, no music, no server. It works on
  somebody else's library, because the sliders are positions on percentiles each
  collection computes for itself. "My 2am setting" means something on your records
  too.
- **X-rays your collection.** One window shows where your library actually sits:
  a tempo histogram, the Camelot wheel with every position lit by how much of your
  music is in it, and the decades if your files carry years. Nothing you play tells
  you this, and no service can — it is read off the audio.
- **Finds the same recording twice, by sound.** The 320 and the 128 of one rip, the
  album track and the compilation copy, the remaster beside the original: tags miss
  all three, because the tags are exactly what differs. vibeamp stores a small
  fingerprint of how each track's harmony moves over time, which survives
  re-encoding, a gain change and a remaster, and differs between two pieces of
  music even when they share a key and a tempo. It lists what it finds and never
  deletes anything — a radio edit or another take can land there too.
- **Tells you which files are broken.** Not by their tags — by their samples. A
  "stereo" file whose two channels carry the same signal, a download that stopped
  early and ends at full level, a master clipped flat against the ceiling, a rip
  that produced forty minutes of silence. Every threshold was measured rather than
  guessed, and a track that merely stops dead on a beat is left alone. It also says
  what it _cannot_ see: a file re-encoded from a lossy source is invisible, because
  the analysis runs at 16 kHz and an encoder's fingerprint lives above that.
- **Names the files that have none, by ear.** Every old collection has a folder of
  `track03.mp3` that no tag database ever reached. If the same recording is also in
  your library _with_ tags — the album copy beside the compilation copy — the
  fingerprint finds it and the name is borrowed, which nothing about the two files'
  names, sizes or dates could have told you. The rest are read off the folders,
  where whoever ripped them typed the artist once. Names are stored beside your
  tags, never written into your files, and forgetting them is the whole of the undo.
- **Tells you what you already own.** Paste a list — a streaming service export,
  an `.m3u`, or "Artist – Title" one per line — and it says which of them are on
  your shelf, matching through the spellings two taggers disagree about and through
  the names it worked out above. It will not guess what the missing ones sound like:
  a name carries no tempo and no key, and this program does not invent metadata.
- **Compares your collection with a friend's, without a server.** One button copies
  fifty-seven characters holding two histograms and a count — no titles, no artists,
  nothing that says what you own. Paste theirs and you get where you both live,
  where each of you lives alone, and a playlist of **your** records from the ground
  you share.
- **Plays the whole collection at one volume.** A CD mastered in 1985 and a
  reissue from 2015 are ten decibels apart, and every few tracks somebody reaches
  for the volume. This is ReplayGain without the tags: the level of every track was
  measured when it was analysed, so the correction needs nothing written in the
  file. The reference is your library's own middle, so half of it moves up and half
  moves down and the master fader stays where it was — and a boost is capped by the
  headroom actually measured, so nothing is ever turned up into the ceiling.
- **Knows where a track really starts and stops.** A file's length and a
  recording's length are different things, and every collection is full of the
  difference: a rip that kept the lead-in, a download padded by its encoder, an
  album track with the run-out left on. Silence at the ends is skipped, the fade
  aims at the end of the _music_, and the condition report names the padded files
  in case you would rather fix the rip. Dead air only: a quiet intro is never cut
  and a fade-out is never trimmed.
- **Gets you from one record to another.** Name where you are and where you want to
  end up and it lays out the route between them, out of your own records, each step
  a move it can explain. Nothing is sped up or slowed down — it is a route through a
  collection, not a mix. No service can do it, because nothing a service stores
  about a track is a distance to another one.
- **Brings the next track in on the beat.** Not beatmatching — nothing is sped up,
  and both records play at their own tempo. The incoming track simply starts from
  the point that puts its first beat where the outgoing track's next beat falls, and
  it is nudged while that deck is still silent, so you never hear the seek. It says
  how long the alignment lasts rather than pretending two different tempos stay
  together.
- **Shows you the queue, and why.** The next four tracks with their tempo and
  Camelot code, and one line for the move about to happen: `+6 bpm · 8B→8A
relative · energy +12`. Where it is not sure of a key it says so instead of
  inventing a reason.
- **Looks and works like Winamp, because it is Webamp.** The shell is
  [Webamp](https://webamp.org): three draggable,
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
- **Works on a phone.** One column: the player and the playlist, then the vibe
  panel under them with controls sized for a thumb. The equaliser starts closed
  and is one tap away.
- **Is honest about what it knows.** Below 30 analysed tracks the auto-DJ turns
  itself off and says why, because a recommender with too little to go on produces
  queues that are obviously wrong. Descriptors measured before the library was big
  enough are marked provisional.
- **Stays out of the way while it works.** The playlist is playable before a single
  track has been analysed. Analysis runs in the background, one file at a time, and
  pauses itself on low battery or when the tab has been hidden for five minutes.

## What it is not

It does not stream, it has no catalogue, and it will not find you music you do not
already own. It is not a DJ tool: nothing is time-stretched, there is no
beatmatching and there are no cue points — a track that enters on the beat is two
records meeting on one beat, not two records held together. And it does not diagnose
your taste — every number it stores is a measurement of a waveform, and the ones
that are proxies say so.

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

The features that involve somebody else involve no network either. A want list is
read in the page and goes nowhere. A shape code is two histograms and a count, and
you send it yourself, to whoever you meant to send it to. There is no acoustic
lookup against an online database, and [the specification](docs/specification.md)
says why.

## Licence

MIT. The shell is [Webamp](https://github.com/captbaritone/webamp) by Jordan
Eldredge, also MIT; the visualiser is [Butterchurn](https://github.com/jberg/butterchurn),
also MIT.

Every package this app ships is permissive: 28 MIT, one Apache-2.0 (Dexie) and one
BSD-3-Clause (ieee754). Nothing copyleft, which was the point of
[decision 0002](docs/decisions/0002-descriptors-in-typescript.md) — the obvious
descriptor library is AGPL, and publishing this site with it would have put the
whole app under AGPL.

All three licences ask that the copyright and permission notices travel with the
copies you distribute, and a minified bundle is a copy — the minifier strips them,
so the build writes them back out to `THIRD-PARTY-NOTICES.txt`, served next to the
app and linked from its `<head>`.

Winamp is a trademark of its owner. vibeamp is not affiliated with, endorsed by or
connected to it; it is an independent project that wears the interface Webamp
recreates and loads the skins people made for it. No skins ship with the app —
those belong to the people who drew them.
Winamp skins are the work of their authors and none are redistributed here.
