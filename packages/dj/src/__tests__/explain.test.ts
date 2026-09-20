import { describe, expect, it } from 'vitest';

import { KEY_STRENGTH_FLOOR } from '../scoring.js';
import { explainTransition, keyRelationLabel } from '../explain.js';
import { makeTrack } from './tracks.js';

describe('explainTransition', () => {
  it('reports the tempo change with its sign', () => {
    const transition = explainTransition(
      makeTrack({ id: 'a', bpm: 124 }),
      makeTrack({ id: 'b', bpm: 130 }),
    );

    expect(transition?.bpmFrom).toBe(124);
    expect(transition?.bpmTo).toBe(130);
    expect(transition?.bpmDelta).toBe(6);
    expect(transition?.summary).toContain('+6 bpm');
  });

  it('keeps the sign on the way down', () => {
    const transition = explainTransition(
      makeTrack({ id: 'a', bpm: 130 }),
      makeTrack({ id: 'b', bpm: 124 }),
    );

    expect(transition?.bpmDelta).toBe(-6);
    expect(transition?.summary).toContain('-6 bpm');
  });

  it('names the same key', () => {
    const transition = explainTransition(
      makeTrack({ id: 'a', root: 'C', scale: 'major' }),
      makeTrack({ id: 'b', root: 'C', scale: 'major' }),
    );

    expect(transition?.keyRelation).toBe('same');
  });

  it('names the relative minor', () => {
    // C major and A minor are 8B and 8A: the same number, the forgiving move.
    const transition = explainTransition(
      makeTrack({ id: 'a', root: 'C', scale: 'major' }),
      makeTrack({ id: 'b', root: 'A', scale: 'minor' }),
    );

    expect(transition?.camelotFrom).toBe('8B');
    expect(transition?.camelotTo).toBe('8A');
    expect(transition?.keyRelation).toBe('relative');
  });

  it('names a step around the wheel', () => {
    // C major to G major is 8B to 9B: one step.
    const transition = explainTransition(
      makeTrack({ id: 'a', root: 'C', scale: 'major' }),
      makeTrack({ id: 'b', root: 'G', scale: 'major' }),
    );

    expect(transition?.keyRelation).toBe('neighbour');
  });

  it('calls a distant key what it is', () => {
    const transition = explainTransition(
      makeTrack({ id: 'a', root: 'C', scale: 'major' }),
      makeTrack({ id: 'b', root: 'F#', scale: 'major' }),
    );

    expect(transition?.keyRelation).toBe('distant');
  });

  it('says the key is unsure rather than inventing a relation', () => {
    // The scoring already fades the key cost out below this strength. Reporting a
    // relation from an estimate the planner does not trust would be a lie with a
    // number attached.
    const transition = explainTransition(
      makeTrack({ id: 'a', keyStrength: KEY_STRENGTH_FLOOR }),
      makeTrack({ id: 'b', root: 'A', scale: 'minor' }),
    );

    expect(transition?.keyRelation).toBe('unknown');
    expect(transition?.camelotFrom).toBeNull();
    expect(transition?.summary).toContain('key unsure');
  });

  it('says the tempo is unsure when one is missing', () => {
    const transition = explainTransition(
      makeTrack({ id: 'a', bpm: 0 }),
      makeTrack({ id: 'b', bpm: 120 }),
    );

    expect(transition?.bpmDelta).toBe(0);
    expect(transition?.summary).toContain('tempo unsure');
    expect(transition?.summary).not.toContain('+0 bpm');
  });

  it('reports the energy step as library percentage points', () => {
    const transition = explainTransition(
      makeTrack({ id: 'a', energy: 0.4 }),
      makeTrack({ id: 'b', energy: 0.62 }),
    );

    expect(transition?.energyDelta).toBeCloseTo(0.22, 6);
    expect(transition?.summary).toContain('energy +22');
  });

  it('has nothing to say about a track with no analysis', () => {
    expect(
      explainTransition(makeTrack({ id: 'a' }), makeTrack({ id: 'b', analysed: false })),
    ).toBeNull();
    expect(
      explainTransition(makeTrack({ id: 'a', analysed: false }), makeTrack({ id: 'b' })),
    ).toBeNull();
  });
});

describe('keyRelationLabel', () => {
  it('has wording for every relation', () => {
    for (const relation of [
      'same',
      'relative',
      'neighbour',
      'two-steps',
      'distant',
      'unknown',
    ] as const) {
      expect(keyRelationLabel(relation).length).toBeGreaterThan(0);
    }
  });
});
