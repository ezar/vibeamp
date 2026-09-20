# 4. The plan lives outside the shell

**Status:** accepted · **Date:** 2026-09-20

## Context

"Move a slider and the queue reorders, without interrupting what is playing" is the
product's demonstration moment. It needs the tracks _after_ the current one to be
replaceable.

Webamp's playlist offers `appendTracks`, which adds to the end, and
`setTracksToPlay`, which replaces everything and starts playing the first track.
Neither can rewrite the tail. Its Redux store is exposed and a removal action could
be dispatched into it, but that is internal API, and a queue that silently stops
working on a Webamp upgrade is worse than a queue that is a little slower to react.

## Decision

The plan is held by `QueueController`, outside the shell, and only
`SHELL_LOOKAHEAD` — two — tracks are handed over at a time.

Two, because one is needed so the crossfade has something to fade into, and anything
more is queue the listener would have to sit through before a slider move became
audible.

Replanning rewrites our list, which is entirely ours. What the shell already holds
plays out first.

## Consequences

- No internal API is touched, so a Webamp upgrade cannot quietly break the queue.
- A slider move reaches the listener after at most two tracks rather than
  immediately. In practice the change is heard within one track, because the next
  one is usually already playing when the slider moves.
- Webamp's playlist window shows two tracks ahead rather than twenty. The full plan
  is ours and could be shown in the vibe window, which is a better place for it: it
  can show _why_ each track was chosen, which the shell's playlist cannot.
- If Webamp ever adds a public way to modify the playlist, the lookahead becomes a
  constant to raise and nothing else changes.
