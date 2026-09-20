/**
 * Saying why one track follows another.
 *
 * The planner already knows: it scored every candidate on tempo, key, energy and
 * timbre and picked the cheapest. None of that reaches the listener, who sees a
 * queue appear and has to take it on faith.
 *
 * This turns the same three quantities the scoring uses into something readable.
 * It re-derives them from the two tracks rather than reading the planner's cost,
 * because a single number is not an explanation: "+6 bpm, relative minor" is.
 *
 * Nothing here is a claim about quality. It reports what changed between two
 * tracks; whether that is a good transition is the listener's call.
 */

import { camelotDistance } from '@vibeamp/core';
import type { Track } from '@vibeamp/core';
import { keyReliability } from './scoring.js';

/** How two keys sit on the Camelot wheel. */
export type KeyRelation =
  | 'same'
  | 'relative'
  | 'neighbour'
  | 'two-steps'
  | 'distant'
  /** One of the two tracks has no key worth reporting. */
  | 'unknown';

/** What the wheel's distances mean, in the order `camelotDistance` returns them. */
const RELATIONS: ReadonlyArray<readonly [distance: number, relation: KeyRelation]> = [
  [0, 'same'],
  [0.15, 'relative'],
  [0.25, 'neighbour'],
  [0.55, 'two-steps'],
];

/** Wording for each relation, short enough for a 277px window. */
const RELATION_LABELS: Record<KeyRelation, string> = {
  same: 'same key',
  relative: 'relative',
  neighbour: 'one step',
  'two-steps': 'two steps',
  distant: 'key jump',
  unknown: 'key unsure',
};

export interface Transition {
  bpmFrom: number;
  bpmTo: number;
  /** Signed, in BPM. Zero when either tempo is unknown. */
  bpmDelta: number;
  camelotFrom: string | null;
  camelotTo: string | null;
  keyRelation: KeyRelation;
  /** Signed, on the library's 0..1 energy percentile. */
  energyDelta: number;
  /** The whole thing on one line, ready to render. */
  summary: string;
}

/**
 * Describe the move from one track to the next.
 *
 * @returns `null` when either track has no analysis, which is the one case where
 *   there is nothing honest to say.
 */
export function explainTransition(from: Track, to: Track): Transition | null {
  const before = from.analysis;
  const after = to.analysis;
  if (before === null || after === null) return null;

  const tempoKnown = before.bpm > 0 && after.bpm > 0;
  const bpmDelta = tempoKnown ? Math.round(after.bpm) - Math.round(before.bpm) : 0;

  const keyKnown =
    keyReliability(before.key.strength) > 0 && keyReliability(after.key.strength) > 0;
  const keyRelation = keyKnown ? relationFor(before.key.camelot, after.key.camelot) : 'unknown';
  const energyDelta = after.energy - before.energy;

  return {
    bpmFrom: Math.round(before.bpm),
    bpmTo: Math.round(after.bpm),
    bpmDelta,
    camelotFrom: keyKnown ? before.key.camelot : null,
    camelotTo: keyKnown ? after.key.camelot : null,
    keyRelation,
    energyDelta,
    summary: [
      tempoKnown ? `${signed(bpmDelta)} bpm` : 'tempo unsure',
      keyKnown
        ? `${before.key.camelot}→${after.key.camelot} ${RELATION_LABELS[keyRelation]}`
        : RELATION_LABELS.unknown,
      `energy ${signed(Math.round(energyDelta * 100))}`,
    ].join(' · '),
  };
}

/** The wording for a relation, for a caller rendering the parts itself. */
export function keyRelationLabel(relation: KeyRelation): string {
  return RELATION_LABELS[relation];
}

function relationFor(a: string, b: string): KeyRelation {
  const distance = camelotDistance(a, b);
  for (const [value, relation] of RELATIONS) {
    if (distance === value) return relation;
  }
  return 'distant';
}

/** `+3`, `-3`, `0`: the sign is the point, so zero keeps none. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
