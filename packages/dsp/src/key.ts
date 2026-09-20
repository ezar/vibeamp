/**
 * Key estimation by correlating a chroma vector against key profiles.
 *
 * The profiles are Krumhansl and Kessler's probe-tone ratings, the same ones most
 * open implementations use. Each of the 24 keys is scored by the Pearson
 * correlation between the chroma, rotated to that tonic, and the profile for that
 * mode; the best correlation wins.
 *
 * Notes are always named with sharps. Flats and sharps are the same twelve pitch
 * classes, and the Camelot table in `@vibeamp/core` is written in sharps, so
 * normalising here means nothing downstream has to know about enharmonics.
 */

/** Pitch class names, index 0 = C, sharps only. */
export const PITCH_CLASS_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export type PitchClassName = (typeof PITCH_CLASS_NAMES)[number];
export type KeyScale = 'major' | 'minor';

/** Krumhansl-Kessler probe-tone profile for a major key, starting at the tonic. */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const;

/** Krumhansl-Kessler probe-tone profile for a minor key, starting at the tonic. */
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const;

export interface KeyEstimate {
  /** Tonic, named with sharps. */
  root: PitchClassName;
  scale: KeyScale;
  /**
   * Correlation of the winning key, clamped to 0..1.
   *
   * Above roughly 0.75 for tonal music with a clear centre, below 0.5 for
   * something atonal, percussive or too short to have a key at all.
   */
  strength: number;
  /**
   * How far the winner leads the best key of the other mode, 0..1.
   *
   * Low when a track's relative major and minor score almost the same, which is
   * common and is exactly where the Camelot wheel forgives the mistake anyway.
   */
  margin: number;
}

/**
 * Estimate the key of a chroma vector.
 *
 * A vector of all zeros has no key; C major is returned with zero strength so
 * that callers never have to handle a null, and the strength says not to trust it.
 */
export function estimateKey(chroma: Float64Array): KeyEstimate {
  if (chroma.length !== 12) throw new Error(`chroma must be 12 long, got ${chroma.length}`);

  let best = { root: 0, scale: 'major' as KeyScale, score: -Infinity };
  let bestMajor = -Infinity;
  let bestMinor = -Infinity;

  for (let tonic = 0; tonic < 12; tonic++) {
    const major = correlateRotated(chroma, MAJOR_PROFILE, tonic);
    const minor = correlateRotated(chroma, MINOR_PROFILE, tonic);
    if (major > bestMajor) bestMajor = major;
    if (minor > bestMinor) bestMinor = minor;
    if (major > best.score) best = { root: tonic, scale: 'major', score: major };
    if (minor > best.score) best = { root: tonic, scale: 'minor', score: minor };
  }

  if (!Number.isFinite(best.score)) {
    return { root: 'C', scale: 'major', strength: 0, margin: 0 };
  }

  const runnerUp = best.scale === 'major' ? bestMinor : bestMajor;
  return {
    root: PITCH_CLASS_NAMES[best.root] ?? 'C',
    scale: best.scale,
    strength: clamp01(best.score),
    margin: clamp01(best.score - runnerUp),
  };
}

/**
 * Pearson correlation between a chroma vector rotated to `tonic` and a profile.
 *
 * Returns 0 when either side has no variance, which happens for silence and for
 * a chroma that is perfectly flat.
 */
function correlateRotated(chroma: Float64Array, profile: readonly number[], tonic: number): number {
  let chromaMean = 0;
  let profileMean = 0;
  for (let i = 0; i < 12; i++) {
    chromaMean += chroma[i];
    profileMean += profile[i] ?? 0;
  }
  chromaMean /= 12;
  profileMean /= 12;

  let covariance = 0;
  let chromaVariance = 0;
  let profileVariance = 0;
  for (let i = 0; i < 12; i++) {
    const c = chroma[(i + tonic) % 12] - chromaMean;
    const p = (profile[i] ?? 0) - profileMean;
    covariance += c * p;
    chromaVariance += c * c;
    profileVariance += p * p;
  }

  const denominator = Math.sqrt(chromaVariance * profileVariance);
  return denominator === 0 ? 0 : covariance / denominator;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
