/**
 * Scoring a candidate against a target.
 *
 * Everything is a cost, and the lowest cost wins, so a term that cannot be
 * evaluated contributes its maximum rather than a zero. That distinction matters:
 * treating an unknown key as a perfect match makes unanalysed tracks beat analysed
 * ones, and the queue fills up with exactly the tracks it knows least about.
 */

import { camelotDistance } from '@vibeamp/core';
import type { Track, VibeTarget } from '@vibeamp/core';

export interface ScoreWeights {
  bpm: number;
  key: number;
  energy: number;
  timbre: number;
  novelty: number;
}

/** The defaults. They sum to 1, which keeps a total cost readable as 0..1-ish. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  bpm: 0.25,
  key: 0.2,
  energy: 0.3,
  timbre: 0.15,
  novelty: 0.1,
};

/** Relative BPM difference treated as a full mismatch. */
export const BPM_TOLERANCE = 0.08;

export interface QueueContext {
  /** Artists of the last few tracks played or queued. */
  recentArtists: readonly string[];
  /** Albums of the last few tracks played or queued. */
  recentAlbums: readonly string[];
  /** Whether a track was played recently enough to feel repetitive. */
  playedRecently: (trackId: string) => boolean;
  /**
   * How often a track has been played, 0..1, relative to the most played in the
   * library. Drives the familiarity slider.
   */
  playFrequency: (trackId: string) => number;
}

/**
 * Bend the weights with the coherence slider.
 *
 * At 1 the queue cares about nothing but tempo and key; at 0 it ignores them and
 * chases the vibe target and variety instead. The sum is held at the original
 * total so that costs stay comparable as the slider moves.
 */
export function weightsForCoherence(coherence: number, base = DEFAULT_WEIGHTS): ScoreWeights {
  const amount = clamp01(coherence);
  // 1 at coherence 0.5, up to 2 at 1, down to 0 at 0.
  const musical = amount * 2;
  const rest = 2 - musical;

  const scaled: ScoreWeights = {
    bpm: base.bpm * musical,
    key: base.key * musical,
    energy: base.energy * rest,
    timbre: base.timbre * rest,
    novelty: base.novelty * rest,
  };

  const total = scaled.bpm + scaled.key + scaled.energy + scaled.timbre + scaled.novelty;
  const baseTotal = base.bpm + base.key + base.energy + base.timbre + base.novelty;
  if (total === 0) return base;
  const correction = baseTotal / total;
  return {
    bpm: scaled.bpm * correction,
    key: scaled.key * correction,
    energy: scaled.energy * correction,
    timbre: scaled.timbre * correction,
    novelty: scaled.novelty * correction,
  };
}

/**
 * Relative tempo difference between two tracks, allowing half and double time.
 *
 * @returns The smallest difference as a fraction of `fromBpm`: 0.05 means five per
 *   cent out. `Infinity` when either tempo is unknown.
 */
export function relativeBpmDistance(fromBpm: number, toBpm: number): number {
  if (fromBpm <= 0 || toBpm <= 0) return Infinity;
  let best = Infinity;
  for (const ratio of [1, 0.5, 2]) {
    const distance = Math.abs(toBpm * ratio - fromBpm) / fromBpm;
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Tempo cost between two tracks, 0..1.
 *
 * Half time and double time count as matches. A 140 BPM track after a 70 BPM one is
 * a move a DJ makes deliberately, and scoring it as the worst possible transition
 * would rule out half the useful ones.
 */
export function bpmCost(fromBpm: number, toBpm: number): number {
  const distance = relativeBpmDistance(fromBpm, toBpm);
  if (!Number.isFinite(distance)) return 1;
  return Math.min(1, distance / BPM_TOLERANCE);
}

/**
 * Total cost of playing `candidate` after `current`.
 *
 * @param target Where the vibe sliders and the energy curve say the queue should be.
 * @returns A cost; lower is better. `Infinity` for a candidate with no analysis,
 *   which the planner filters out before it gets here.
 */
export function scoreCandidate(
  current: Track,
  candidate: Track,
  target: VibeTarget & { energy: number },
  context: QueueContext,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const from = current.analysis;
  const to = candidate.analysis;
  if (from === null || to === null) return Infinity;

  const tempo = bpmCost(from.bpm, to.bpm);
  // An unreliable tempo should not drive the transition. Fading the cost towards
  // neutral is better than either trusting it or discarding the track.
  const tempoConfidence = Math.min(from.bpmConfidence, to.bpmConfidence);
  const tempoCost = tempo * tempoConfidence + 0.5 * (1 - tempoConfidence);

  const keyCost = camelotDistance(from.key.camelot, to.key.camelot);
  const energyCost = Math.abs(to.energy - target.energy);
  const timbreCost =
    0.6 * Math.abs(to.brightness - target.brightness) +
    0.4 * Math.abs(to.danceability - target.danceability);

  return (
    weights.bpm * tempoCost +
    weights.key * keyCost +
    weights.energy * energyCost +
    weights.timbre * timbreCost +
    weights.novelty * noveltyCost(candidate, target, context)
  );
}

/**
 * Cost of repetition, and of missing the familiarity target.
 *
 * Unbounded above by design: three penalties can stack, and a track that was
 * playing ten minutes ago should lose to almost anything.
 */
export function noveltyCost(
  candidate: Track,
  target: Pick<VibeTarget, 'familiarity'>,
  context: QueueContext,
): number {
  let cost = 0;
  const artist = candidate.meta.artist;
  const album = candidate.meta.album;
  if (artist !== null && context.recentArtists.includes(artist)) cost += 0.6;
  if (album !== null && context.recentAlbums.includes(album)) cost += 0.3;
  if (context.playedRecently(candidate.id)) cost += 1;
  // The slider asks for well-worn or forgotten tracks; the distance from what it
  // asks for is the cost.
  cost += Math.abs(context.playFrequency(candidate.id) - clamp01(target.familiarity));
  return cost;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
