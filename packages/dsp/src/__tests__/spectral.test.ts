import { describe, expect, it } from 'vitest';
import { Spectrogram } from '../spectrum.js';
import {
  lowBandEnergyRatio,
  peakAmplitude,
  rms,
  spectralCentroid,
  spectralFlux,
  spectralRolloff,
  zeroCrossingRate,
} from '../spectral.js';
import { crestFactor, toDbfs } from '../loudness.js';
import { sine, whiteNoise } from './signals.js';

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 2048;

function magnitudesOf(signal: Float32Array): { magnitudes: Float64Array; frameSize: number } {
  const spectrogram = new Spectrogram({ frameSize: FRAME_SIZE, hopSize: FRAME_SIZE / 2 });
  const magnitudes = new Float64Array(spectrogram.binCount);
  spectrogram.magnitudesAt(signal, 0, magnitudes);
  return { magnitudes, frameSize: FRAME_SIZE };
}

describe('spectral centroid', () => {
  it('lands on the frequency of a pure tone', () => {
    const { magnitudes, frameSize } = magnitudesOf(sine(1000, 1, SAMPLE_RATE));
    expect(spectralCentroid(magnitudes, SAMPLE_RATE, frameSize)).toBeCloseTo(1000, -2);
  });

  it('is higher for a high tone than a low one', () => {
    const low = magnitudesOf(sine(200, 1, SAMPLE_RATE));
    const high = magnitudesOf(sine(4000, 1, SAMPLE_RATE));
    expect(spectralCentroid(high.magnitudes, SAMPLE_RATE, FRAME_SIZE)).toBeGreaterThan(
      spectralCentroid(low.magnitudes, SAMPLE_RATE, FRAME_SIZE),
    );
  });

  it('is zero for silence rather than NaN', () => {
    const { magnitudes } = magnitudesOf(new Float32Array(SAMPLE_RATE));
    expect(spectralCentroid(magnitudes, SAMPLE_RATE, FRAME_SIZE)).toBe(0);
  });
});

describe('spectral rolloff', () => {
  it('sits just above a pure tone', () => {
    const { magnitudes } = magnitudesOf(sine(1000, 1, SAMPLE_RATE));
    const rolloff = spectralRolloff(magnitudes, SAMPLE_RATE, FRAME_SIZE);
    expect(rolloff).toBeGreaterThan(900);
    expect(rolloff).toBeLessThan(1200);
  });

  it('is zero for silence', () => {
    const { magnitudes } = magnitudesOf(new Float32Array(SAMPLE_RATE));
    expect(spectralRolloff(magnitudes, SAMPLE_RATE, FRAME_SIZE)).toBe(0);
  });
});

describe('spectral flux', () => {
  it('counts energy arriving and ignores energy leaving', () => {
    const quiet = new Float64Array([1, 1, 1]);
    const loud = new Float64Array([3, 1, 1]);
    expect(spectralFlux(loud, quiet)).toBe(2);
    expect(spectralFlux(quiet, loud)).toBe(0);
  });
});

describe('zero crossing rate', () => {
  it('matches the two crossings per period of a sine', () => {
    const frequency = 400;
    const signal = sine(frequency, 1, SAMPLE_RATE);
    const expected = (2 * frequency) / SAMPLE_RATE;
    expect(zeroCrossingRate(signal, 0, signal.length)).toBeCloseTo(expected, 3);
  });

  it('is much higher for noise than for a bass tone', () => {
    const bass = sine(60, 1, SAMPLE_RATE);
    const noise = whiteNoise(1, SAMPLE_RATE);
    expect(zeroCrossingRate(noise, 0, noise.length)).toBeGreaterThan(
      10 * zeroCrossingRate(bass, 0, bass.length),
    );
  });

  it('clamps a slice that runs past the end', () => {
    const signal = sine(400, 0.1, SAMPLE_RATE);
    expect(zeroCrossingRate(signal, signal.length - 10, 1000)).toBeGreaterThanOrEqual(0);
    expect(zeroCrossingRate(signal, signal.length + 5, 100)).toBe(0);
  });
});

describe('level descriptors', () => {
  it('gives a sine an RMS of its amplitude over root two', () => {
    const signal = sine(440, 1, SAMPLE_RATE, 0.5);
    expect(rms(signal)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(peakAmplitude(signal)).toBeCloseTo(0.5, 2);
  });

  it('gives a sine a crest factor of root two', () => {
    expect(crestFactor(sine(440, 1, SAMPLE_RATE))).toBeCloseTo(Math.SQRT2, 2);
  });

  it('reports digital silence as minus infinity decibels', () => {
    expect(toDbfs(0)).toBe(-Infinity);
    expect(toDbfs(1)).toBeCloseTo(0, 6);
    expect(toDbfs(0.5)).toBeCloseTo(-6.02, 1);
  });
});

describe('low band energy ratio', () => {
  it('is near one for a bass tone and near zero for a high one', () => {
    const bass = magnitudesOf(sine(80, 1, SAMPLE_RATE));
    const treble = magnitudesOf(sine(6000, 1, SAMPLE_RATE));
    expect(lowBandEnergyRatio(bass.magnitudes, SAMPLE_RATE, FRAME_SIZE)).toBeGreaterThan(0.9);
    expect(lowBandEnergyRatio(treble.magnitudes, SAMPLE_RATE, FRAME_SIZE)).toBeLessThan(0.05);
  });
});

describe('Spectrogram', () => {
  it('counts whole frames only', () => {
    const spectrogram = new Spectrogram({ frameSize: 1024, hopSize: 512 });
    expect(spectrogram.frameCount(1023)).toBe(0);
    expect(spectrogram.frameCount(1024)).toBe(1);
    expect(spectrogram.frameCount(1536)).toBe(2);
  });

  it('zero pads a frame that runs past the end instead of reading undefined', () => {
    const spectrogram = new Spectrogram({ frameSize: 1024, hopSize: 512 });
    const magnitudes = new Float64Array(spectrogram.binCount);
    spectrogram.magnitudesAt(sine(440, 0.02, SAMPLE_RATE), 200, magnitudes);
    for (let bin = 0; bin < magnitudes.length; bin++) {
      expect(Number.isFinite(magnitudes[bin]!)).toBe(true);
    }
  });
});
