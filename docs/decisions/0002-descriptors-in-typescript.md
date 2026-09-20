# 2. The descriptors are implemented here, not taken from Essentia

**Status:** accepted · **Date:** 2026-09-20

## Context

The first specification named Essentia.js for every descriptor, devoted a section to
managing its WebAssembly heap — "the point where these projects fall over after two
hours" — and called the worker integration the project's highest technical risk.

Three facts about the package:

- It is **AGPL-3.0**. These projects are MIT. Shipping an AGPL library in a web app
  puts the whole app under AGPL, including an obligation to offer source to anyone
  who uses it over a network.
- It ships **no type definitions**, against a specification requiring strict
  TypeScript with no `any` at any boundary.
- The last release was **June 2021**.

The descriptors needed are not exotic. Tempo, key, spectral centroid, crest factor,
zero crossing rate and spectral flux are textbook signal processing with
well-documented methods.

## Decision

Implement them in `@vibeamp/dsp`: plain TypeScript, no native dependency.

The licence conflict was the reason to look, but it is not the reason to stay. What
the change actually bought:

- **The largest risk disappears with the WebAssembly.** There is no heap to leak,
  no `.delete()` to forget, no worker recycling itself when its heap grows
  monotonically. The section of the specification devoted to it became unnecessary.
- **Everything is testable in Node**, over generated signals. A failure reproduces
  from a click track, not from a file. Three genuine bugs in the tempo estimator
  were found this way.
- **The error surface shrinks.** `wasm_init` and `oom` are no longer possible
  outcomes, so they are no longer codes.

The cost is accuracy: Essentia's algorithms are tuned and validated, and these are
not. That is answered by measuring rather than by assuming — tempo is correct within
one per cent from 60 to 174 BPM on generated click tracks, and all 24 keys are
recovered — and by being honest where a method is weaker than its reference.

Danceability is the clearest case. It is **not** Essentia's, which uses detrended
fluctuation analysis. It is a composite of pulse clarity, low-band energy share and
onset density, and it is named a proxy in its own documentation, in the
specification and wherever it is surfaced.

## Consequences

- vibeamp stays MIT, consistent with its sibling projects.
- If a descriptor turns out to need more than this, the boundary to replace is one
  pure function, and an Essentia-backed implementation could sit behind it — at the
  cost of relicensing the app, which is then a deliberate decision rather than an
  accident of a dependency.
- The project owns its signal processing, which is more work and also the part worth
  owning.
