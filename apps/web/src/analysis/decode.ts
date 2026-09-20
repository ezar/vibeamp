/**
 * Decoding, on the main thread because there is nowhere else.
 *
 * `decodeAudioData` is not available in a worker, which is the constraint the whole
 * pipeline is built around. Decoding is also the expensive half of the analysis, so
 * it runs one file at a time with the thread handed back in between: an analysis
 * that takes twenty minutes with a responsive interface is better than one that
 * takes eight with a stuttering one.
 */

import { downmixToMono, resampleLinear } from '@vibeamp/dsp';
import { TARGET_SAMPLE_RATE } from '@vibeamp/analysis';

export interface DecodedAudio {
  /** Mono samples at {@link TARGET_SAMPLE_RATE}. */
  samples: Float32Array;
  sampleRate: number;
  /** Duration of the original file, in seconds. */
  durationSec: number;
}

/** The file could not be decoded by this browser. Never worth retrying. */
export class UndecodableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndecodableError';
  }
}

/**
 * Decode a file to mono at the analysis sample rate.
 *
 * The trick is to decode into an `OfflineAudioContext` created at the target rate:
 * the decoder resamples on the way out, so a five minute track becomes about 19 MB
 * of `Float32Array` instead of 100. Safari has historically ignored the context's
 * rate and returned the file's own, so the result is checked and resampled by hand
 * when it does not match. Analysing a 44.1 kHz buffer as though it were 16 kHz
 * reports every tempo and every centroid out by a factor of 2.76.
 */
export async function decodeMono(file: Blob): Promise<DecodedAudio> {
  const bytes = await file.arrayBuffer();

  let buffer: AudioBuffer;
  try {
    // A one frame context: it exists only to own the decode, never to render.
    const context = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
    buffer = await context.decodeAudioData(bytes);
  } catch (cause) {
    throw new UndecodableError(
      cause instanceof Error ? cause.message : 'the browser could not decode this file',
    );
  }

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const mono = downmixToMono(channels);
  const samples =
    buffer.sampleRate === TARGET_SAMPLE_RATE
      ? mono
      : resampleLinear(mono, buffer.sampleRate, TARGET_SAMPLE_RATE);

  return { samples, sampleRate: TARGET_SAMPLE_RATE, durationSec: buffer.duration };
}
