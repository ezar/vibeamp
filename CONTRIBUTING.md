# Contributing to vibeamp

The most useful contribution is usually a better descriptor, and that should never
require touching the shell.

## Ground rules

- Code, comments, identifiers, commits and docs in **English**.
- TypeScript strict everywhere, workers included. No `any`.
- Units in JSDoc on every numeric parameter and returned value: hertz, seconds,
  decibels, beats per minute, samples, or "0..1, a percentile of the library".
- **Every descriptor gets a unit test over a generated signal before it gets a UI.**
  Fixtures are the recipe that builds them, not megabytes of samples, so they stay
  reviewable.
- A measurement that is a proxy says so, in its own documentation and wherever it is
  surfaced. `danceabilityProxy` is the example to copy.
- Conventional commits.
- If you deviate from `docs/specification.md`, add a decision record in
  `docs/decisions/`. Three of the specification's choices have already been
  overturned that way; that is the mechanism working.

## Getting set up

```bash
pnpm install
pnpm verify           # format, lint, typecheck, tests
pnpm dev
```

`pnpm verify` is what CI runs. It should be green before you open a pull request.

## The shape of the repository

The rule that governs it: **`packages/*` may not import the DOM, Web Audio, storage
or anything from `apps/`.** They run in Node. That is what lets the signal
processing and the queue planner be tested over generated signals instead of over a
browser, and it is enforced by each package's `tsconfig.json` declaring no ambient
types.

`apps/web` is the only place that knows about Webamp, IndexedDB and Web Audio.

## Adding a descriptor

1. Write it in `packages/dsp/src/`, as a pure function over samples or a spectrum.
   Document the units and the range in its doc comment.
2. Test it in `packages/dsp/src/__tests__/` against signals from `signals.ts`. A
   descriptor that is right on a synthetic signal and wrong on everything else is
   still worth having; one that is wrong on a synthetic signal is worth nothing.
   Add the generator you need rather than checking in audio.
3. Add it to `RawFeatures` in `packages/core/src/types.ts`, in its own unit.
4. If it should be comparable across the library, add it to `NormalisedDescriptor`
   and to `DEFAULT_RANGES`, and it becomes a percentile automatically. If it is
   already absolute, like tempo, leave it out and pass it through.
5. Bump `ANALYSIS_VERSION`. Every track analysed by an older pipeline goes back to
   pending, keeps its tags and its old numbers, and is re-analysed in the background.

### On naming

Name a descriptor for what it measures, not for what it suggests. The stored value
called `compression` counts how squashed a master is; it was called `dynamics`
first, which reads as dynamic range and means the opposite of the number in it. That
was caught by a test whose expectation disagreed with the implementation, and either
one could have been the bug.

## Working on the queue

`packages/dj` is a pure function of its inputs, including its source of randomness.
Pass a seeded generator and a queue is reproducible, which is how the acceptance
criteria are asserted:

```bash
pnpm test -- queue
```

Two properties are worth protecting when changing the scoring:

- **Tempo continuity.** Consecutive tracks within 10 per cent in at least 80 per
  cent of transitions, measured over several sessions rather than one lucky draw.
- **The sliders do something.** Energy at the top and energy at the bottom must
  produce measurably different queues from the same seed.

A term that cannot be evaluated contributes its **maximum** cost, never zero.
Scoring an unknown key as a perfect match makes unanalysed tracks win, and the queue
fills up with the tracks it knows least about.

## Working on the shell

Don't, if it can be helped. The shell is Webamp and the boundary is its `IMedia`
interface; `apps/web/src/audio/VibeampMedia.ts` implements it. If you change that
file, remember that Webamp subscribes to six events and a missing one is silent: the
time display freezes, or the playlist stops advancing.

Two constraints are already recorded rather than worked around — the vibe sliders
cannot live inside the equaliser window
([0003](docs/decisions/0003-the-vibe-window-is-its-own-window.md)), and the playlist
tail cannot be rewritten
([0004](docs/decisions/0004-the-plan-lives-outside-the-shell.md)). If you find a
third, add a record.

## Pull requests

- `pnpm verify` green.
- One milestone per pull request.
- If you changed the audio graph or the shell, say in the pull request what you
  listened to. Neither clicks nor crossfades show up in a test.
