/**
 * Frame-level spectral and time-domain descriptors.
 *
 * Every function here takes one frame and returns one number, so the caller
 * decides how to aggregate over a window (this pipeline takes means). Slices are
 * clamped to the signal rather than trusted, because the last window of a track
 * routinely asks for samples that are not there.
 */

/** Largest in-bounds length for a slice starting at `offset`. */
function clampLength(signalLength: number, offset: number, length: number): number {
  if (offset < 0 || offset >= signalLength) return 0;
  return Math.min(length, signalLength - offset);
}

/**
 * Spectral centroid: the magnitude-weighted mean frequency, in hertz.
 *
 * This is the "brightness" descriptor. A silent frame has no centroid and returns
 * 0 rather than NaN, so that a mean over a window stays finite.
 */
export function spectralCentroid(
  magnitudes: Float64Array,
  sampleRate: number,
  frameSize: number,
): number {
  let weighted = 0;
  let total = 0;
  for (let bin = 0; bin < magnitudes.length; bin++) {
    const m = magnitudes[bin];
    weighted += ((bin * sampleRate) / frameSize) * m;
    total += m;
  }
  return total === 0 ? 0 : weighted / total;
}

/**
 * Spectral rolloff: the frequency below which `fraction` of the total magnitude
 * lies, in hertz. A second brightness cue, less swayed by one loud fundamental
 * than the centroid is.
 */
export function spectralRolloff(
  magnitudes: Float64Array,
  sampleRate: number,
  frameSize: number,
  fraction = 0.85,
): number {
  let total = 0;
  for (let bin = 0; bin < magnitudes.length; bin++) total += magnitudes[bin];
  if (total === 0) return 0;

  const target = total * fraction;
  let running = 0;
  for (let bin = 0; bin < magnitudes.length; bin++) {
    running += magnitudes[bin];
    if (running >= target) return (bin * sampleRate) / frameSize;
  }
  return ((magnitudes.length - 1) * sampleRate) / frameSize;
}

/**
 * Half-wave rectified spectral flux between two frames: how much energy
 * *appeared* since the previous one.
 *
 * Only increases count, because an onset is energy arriving. Counting decreases
 * too would make every note ending look like a note starting, which is what
 * turns a tempo estimate into noise.
 *
 * @returns Sum of positive magnitude differences, in the magnitude unit.
 */
export function spectralFlux(magnitudes: Float64Array, previous: Float64Array): number {
  const bins = Math.min(magnitudes.length, previous.length);
  let flux = 0;
  for (let bin = 0; bin < bins; bin++) {
    const diff = magnitudes[bin] - previous[bin];
    if (diff > 0) flux += diff;
  }
  return flux;
}

/**
 * Zero crossing rate over a slice, as a fraction of its samples.
 *
 * A cheap noisiness proxy: high for cymbals and distorted guitar, low for a bass
 * line or a held vowel.
 */
export function zeroCrossingRate(signal: Float32Array, offset: number, length: number): number {
  const n = clampLength(signal.length, offset, length);
  if (n < 2) return 0;
  let crossings = 0;
  let previous = signal[offset];
  for (let i = 1; i < n; i++) {
    const sample = signal[offset + i];
    if ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0)) crossings++;
    previous = sample;
  }
  return crossings / (n - 1);
}

/** Root mean square of a slice, in the sample unit (1.0 is full scale). */
export function rms(signal: Float32Array, offset = 0, length = signal.length - offset): number {
  const n = clampLength(signal.length, offset, length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const sample = signal[offset + i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / n);
}

/** Largest absolute sample in a slice, in the sample unit. */
export function peakAmplitude(
  signal: Float32Array,
  offset = 0,
  length = signal.length - offset,
): number {
  const n = clampLength(signal.length, offset, length);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const magnitude = Math.abs(signal[offset + i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/**
 * Ratio of the energy below `splitHz` to the total, 0..1.
 *
 * Stands in for "how much of this is kick and bass", which is one half of the
 * danceability proxy.
 */
export function lowBandEnergyRatio(
  magnitudes: Float64Array,
  sampleRate: number,
  frameSize: number,
  splitHz = 200,
): number {
  const splitBin = Math.min(magnitudes.length - 1, Math.round((splitHz * frameSize) / sampleRate));
  let low = 0;
  let total = 0;
  for (let bin = 0; bin < magnitudes.length; bin++) {
    const energy = magnitudes[bin] ** 2;
    total += energy;
    if (bin <= splitBin) low += energy;
  }
  return total === 0 ? 0 : low / total;
}
