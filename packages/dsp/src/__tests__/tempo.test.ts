import { describe, expect, it } from 'vitest';
import { onsetEnvelope } from '../onset.js';
import { estimateTempo } from '../tempo.js';
import { danceabilityProxy, onsetDensity } from '../danceability.js';
import { clickTrack, sine, whiteNoise } from './signals.js';

const SAMPLE_RATE = 16000;

function tempoOf(signal: Float32Array) {
  return estimateTempo(onsetEnvelope(signal, SAMPLE_RATE));
}

describe('estimateTempo', () => {
  // A tempo estimator that is right on a click track and wrong on everything else
  // is still worth having, and one that is wrong here is worth nothing.
  //
  // The tolerance is relative, because the resolution is: a 100 Hz envelope over 20
  // seconds cannot separate 139.5 from 140. Within one per cent is far inside what
  // the queue asks of it, which tolerates eight.
  it.each([60, 90, 120, 128, 140, 174])('finds %i BPM in a click track', (bpm) => {
    const { bpm: estimated, confidence } = tempoOf(clickTrack(bpm, 20, SAMPLE_RATE));
    expect(Math.abs(estimated - bpm)).toBeLessThan(bpm * 0.01);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it('does not report half or double tempo', () => {
    // The failure mode worth guarding: 120 reported as 60 or 240 wrecks a queue,
    // because every transition then looks like a tempo jump.
    for (const bpm of [100, 120, 130]) {
      const estimated = tempoOf(clickTrack(bpm, 24, SAMPLE_RATE)).bpm;
      expect(Math.abs(estimated - bpm)).toBeLessThan(bpm * 0.05);
    }
  });

  it('is unconfident about signals with no pulse', () => {
    expect(tempoOf(whiteNoise(20, SAMPLE_RATE)).confidence).toBeLessThan(0.3);
    expect(tempoOf(sine(220, 20, SAMPLE_RATE)).confidence).toBeLessThan(0.3);
  });

  it('reports nothing for a signal too short to have a tempo', () => {
    const estimate = tempoOf(clickTrack(120, 1, SAMPLE_RATE));
    expect(estimate.bpm).toBe(0);
    expect(estimate.confidence).toBe(0);
  });

  it('stays inside the reportable range', () => {
    for (const bpm of [45, 60, 120, 200]) {
      const estimated = tempoOf(clickTrack(bpm, 24, SAMPLE_RATE)).bpm;
      expect(estimated).toBeGreaterThanOrEqual(40);
      expect(estimated).toBeLessThanOrEqual(220);
    }
  });
});

describe('onset envelope', () => {
  it('is empty for a signal shorter than one frame', () => {
    expect(onsetEnvelope(new Float32Array(10), SAMPLE_RATE).strength.length).toBe(0);
  });

  it('counts roughly one onset per beat', () => {
    const density = onsetDensity(onsetEnvelope(clickTrack(120, 20, SAMPLE_RATE), SAMPLE_RATE));
    // 120 BPM is 2 beats per second; the peak picker is crude, so this only has to
    // land in the right neighbourhood.
    expect(density).toBeGreaterThan(1);
    expect(density).toBeLessThan(5);
  });
});

describe('danceabilityProxy', () => {
  it('rates a steady beat above an unpulsed drone', () => {
    const beat = onsetEnvelope(clickTrack(124, 20, SAMPLE_RATE), SAMPLE_RATE);
    const drone = onsetEnvelope(sine(110, 20, SAMPLE_RATE), SAMPLE_RATE);

    const danceable = danceabilityProxy({
      envelope: beat,
      pulseClarity: estimateTempo(beat).confidence,
      lowBandRatio: 0.4,
    });
    const undanceable = danceabilityProxy({
      envelope: drone,
      pulseClarity: estimateTempo(drone).confidence,
      lowBandRatio: 0.4,
    });

    expect(danceable).toBeGreaterThan(undanceable);
  });

  it('stays inside 0..1 for every combination of inputs', () => {
    const envelope = onsetEnvelope(clickTrack(120, 8, SAMPLE_RATE), SAMPLE_RATE);
    for (const pulseClarity of [0, 0.5, 1]) {
      for (const lowBandRatio of [0, 0.5, 1]) {
        const value = danceabilityProxy({ envelope, pulseClarity, lowBandRatio });
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
