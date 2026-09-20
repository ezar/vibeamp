/**
 * Named starting points for the sliders.
 *
 * Five sliders and a curve is a lot of surface for someone who just wants the
 * evening to go somewhere. Each preset is a target and a curve together, because
 * the two only mean something in combination: a high energy target on a wind-down
 * curve is not "peak time", it is a contradiction.
 *
 * They are starting points, not modes. Pressing one sets the sliders and nothing
 * else; moving a slider afterwards is an ordinary move, and no preset stays
 * "selected". The queue is planned from wherever the sliders end up.
 */

import type { EnergyShape, VibeTarget } from '@vibeamp/core';

export interface VibePreset {
  /** Stable identifier, used by tests and by the UI as a key. */
  id: string;
  /** What the button says. Short: the row is 277px wide. */
  label: string;
  /** What it does, for the button's title. */
  title: string;
  target: VibeTarget;
  shape: EnergyShape;
}

export const VIBE_PRESETS: readonly VibePreset[] = [
  {
    id: 'warmup',
    label: 'warm',
    title: 'Warm up: quiet and familiar, climbing',
    target: {
      energy: 0.3,
      brightness: 0.4,
      danceability: 0.45,
      familiarity: 0.7,
      coherence: 0.7,
    },
    shape: 'rise',
  },
  {
    id: 'peak',
    label: 'peak',
    title: 'Peak: loud, bright and held there',
    target: {
      energy: 0.85,
      brightness: 0.75,
      danceability: 0.85,
      familiarity: 0.6,
      coherence: 0.8,
    },
    shape: 'flat',
  },
  {
    id: 'dig',
    label: 'dig',
    title: 'Dig: things you have barely played, and a wider net',
    target: {
      energy: 0.55,
      brightness: 0.5,
      danceability: 0.55,
      familiarity: 0.1,
      coherence: 0.25,
    },
    shape: 'arc',
  },
  {
    id: 'late',
    label: 'late',
    title: 'Late: dark and slow, on the way down',
    target: {
      energy: 0.3,
      brightness: 0.2,
      danceability: 0.3,
      familiarity: 0.5,
      coherence: 0.6,
    },
    shape: 'winddown',
  },
];
