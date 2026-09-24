/**
 * vibeamp signal processing.
 *
 * Framework-free TypeScript: samples in, numbers out. Nothing here touches the
 * DOM, Web Audio, WebAssembly or storage, so the same code runs in a worker, in
 * the browser and in Node for the tests.
 *
 * There is deliberately no native dependency. See
 * `docs/decisions/0002-descriptors-in-typescript.md` for why the descriptors are
 * implemented here rather than taken from Essentia.
 */

export { Fft } from './fft.js';
export { hannWindow } from './window.js';
export { Spectrogram } from './spectrum.js';
export type { SpectrogramOptions } from './spectrum.js';
export {
  spectralCentroid,
  spectralRolloff,
  spectralFlux,
  zeroCrossingRate,
  rms,
  peakAmplitude,
  lowBandEnergyRatio,
} from './spectral.js';
export { onsetEnvelope, ONSET_FRAME_SIZE, ONSET_ENVELOPE_RATE } from './onset.js';
export type { OnsetEnvelope } from './onset.js';
export { estimateTempo, MIN_BPM, MAX_BPM } from './tempo.js';
export type { TempoEstimate } from './tempo.js';
export { beatGrid, MIN_GRID_STRENGTH } from './beats.js';
export type { BeatGrid } from './beats.js';
export { soundEdges, EDGE_FLOOR_DB, EDGE_MIN_RUN_SEC } from './edges.js';
export type { SoundEdges } from './edges.js';
export { chromaVector, chromaSequence, CHROMA_FRAME_SIZE } from './chroma.js';
export { estimateKey, PITCH_CLASS_NAMES } from './key.js';
export type { KeyEstimate, KeyScale, PitchClassName } from './key.js';
export { toDbfs, crestFactor, rmsDbfs, clippedRatio } from './loudness.js';
export { sideRatio } from './stereo.js';
export { spectralCutoff, CUTOFF_BAND_HZ } from './cutoff.js';
export { danceabilityProxy, onsetDensity } from './danceability.js';
export type { DanceabilityInputs } from './danceability.js';
export { resampleLinear, downmixToMono } from './resample.js';
