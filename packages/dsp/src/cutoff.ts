/**
 * Where a signal stops.
 *
 * Every lossy encoder throws away the top of the spectrum, and where it stops
 * throwing is the one thing that survives re-encoding: a file made from a 128 kbps
 * source has nothing above about 16 kHz no matter what it is re-encoded to
 * afterwards, and no tag records that. Finding that edge is how a transcode is
 * caught.
 *
 * This cannot run in the ordinary pipeline. The analysis decodes at 16 kHz, so its
 * own ceiling is 8 kHz and the entire octave this measure lives in is gone before
 * any descriptor sees it. It runs on a second decode at the file's own rate, which
 * is expensive enough to be asked for rather than assumed.
 */

import { Spectrogram } from './spectrum.js';

/** Width of the bands the spectrum is summed into, in hertz. */
export const CUTOFF_BAND_HZ = 500;

/** Frame length, in samples. Long, because the edge being looked for is sharp. */
const FRAME_SIZE = 8192;

/**
 * How far below the loudest band a band may sit and still count as content.
 *
 * −55 dB. An encoder's brick wall drops far further than that within a band or two;
 * the quiet but real top end of a lossless file sits above it. Measured either side
 * in `__tests__/cutoff.test.ts`.
 */
const FLOOR_DB = -55;

/** Frames averaged. Enough to smooth a spectrum, few enough to stay cheap. */
const MAX_FRAMES = 64;

/**
 * The highest frequency a signal still has content at.
 *
 * Each band is the *median* of its energy across the frames, not the sum. One
 * frame can be broadband whatever the rest of the file does — a click, an edit
 * point, the join where a track was cut in — and a sum lets that single frame
 * decide the answer for the whole file. A median needs half the file to agree.
 *
 * @param samples Mono samples at the file's own rate, not the analysis rate.
 * @returns The top of the highest band above the floor, in hertz, rounded to the
 *   band width. Null for silence, or a signal too short for one frame, where there
 *   is no spectrum to read.
 */
export function spectralCutoff(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < FRAME_SIZE || sampleRate <= 0) return null;

  const spectrogram = new Spectrogram({ frameSize: FRAME_SIZE, hopSize: FRAME_SIZE / 2 });
  const available = spectrogram.frameCount(samples.length);
  if (available === 0) return null;

  // Spread the frames across the whole signal rather than taking the first few: a
  // track that opens on silence would otherwise be measured on its silence.
  const frames = Math.min(available, MAX_FRAMES);
  const stride = Math.max(1, Math.floor(available / frames));

  const bandCount = Math.ceil(sampleRate / 2 / CUTOFF_BAND_HZ);
  const perFrame: Float64Array[] = [];
  const magnitudes = new Float64Array(spectrogram.binCount);

  for (let frame = 0; frame < frames; frame += 1) {
    spectrogram.magnitudesAt(samples, frame * stride * (FRAME_SIZE / 2), magnitudes);
    const bands = new Float64Array(bandCount);
    for (let bin = 1; bin < spectrogram.binCount; bin += 1) {
      const hz = (bin * sampleRate) / FRAME_SIZE;
      const band = Math.floor(hz / CUTOFF_BAND_HZ);
      if (band >= bandCount) break;
      const magnitude = magnitudes[bin] ?? 0;
      bands[band] = (bands[band] ?? 0) + magnitude * magnitude;
    }
    perFrame.push(bands);
  }

  const bands = new Float64Array(bandCount);
  const column = new Float64Array(perFrame.length);
  for (let band = 0; band < bandCount; band += 1) {
    for (let frame = 0; frame < perFrame.length; frame += 1) {
      column[frame] = perFrame[frame]?.[band] ?? 0;
    }
    bands[band] = median(column);
  }

  let loudest = 0;
  for (const energy of bands) loudest = Math.max(loudest, energy);
  if (loudest === 0) return null;

  const floor = loudest * 10 ** (FLOOR_DB / 10);
  for (let band = bandCount - 1; band >= 0; band -= 1) {
    if ((bands[band] ?? 0) > floor) return (band + 1) * CUTOFF_BAND_HZ;
  }
  return null;
}

/** The middle value, copying first because sorting in place would reorder the caller's buffer. */
function median(values: Float64Array): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
