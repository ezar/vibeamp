# 3. The vibe sliders get their own window

**Status:** accepted · **Date:** 2026-09-20

## Context

The first specification put the vibe sliders in a second tab of the equaliser
window: the same vertical sliders, but the bands are energy, brightness,
danceability, familiarity and coherence instead of frequencies. It is a good idea —
the whole point is that a control from 1997 does something new.

Webamp renders its own windows into its own DOM and exposes no slot for extra
content inside one. Adding a tab to the equaliser window means modifying Webamp,
which means forking it (see decision 0001).

## Decision

The sliders live in a window of their own, styled to match the shell and draggable
by its title bar, docked edge to edge against the three Winamp windows.

Since it cannot be one of Webamp's windows, it is drawn as closely as possible to
one: the same 275px width, no gap where it meets the stack, and Winamp's title bar
with the name centred between two runs of horizontal lines.

## Consequences

- The gesture survives intact: five vertical sliders in the Winamp idiom, and
  releasing one reorders the queue while the music keeps playing.
- It is visibly a separate window rather than part of the equaliser. Less elegant
  than the original idea, and the reason it is worth the effort of looking like one
  of the shell's own windows: on a phone the layout is a single column, and a panel
  that does not match reads as a second application below the player.
- The window is styled by hand rather than skinned, so it does not follow a loaded
  `.wsz`. A skinned version would need the sprite sheet the shell already parsed,
  which Webamp does not expose.
- If this turns out to matter more than the cost of a fork, the fork is where it
  goes, and nothing else in the app changes: the panel is already a self-contained
  component over a plain props interface.
