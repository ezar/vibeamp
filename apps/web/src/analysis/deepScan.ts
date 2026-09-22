/**
 * The second decode.
 *
 * The ordinary pipeline decodes at 16 kHz, which halves the memory a long track
 * costs and puts its own ceiling at 8 kHz. That ceiling is below the one thing
 * that identifies a lossy source, so this decodes the file again at a rate that
 * reaches it.
 *
 * It is not part of the analysis and never runs on its own. A full-rate decode of
 * a five minute track is the memory cost the whole pipeline is built to avoid, so
 * this is asked for, runs one file at a time, and can be stopped.
 */

import { spectralCutoff } from '@vibeamp/dsp';
import { bitrateKbps } from '@vibeamp/core';
import type { CutoffReading, Track } from '@vibeamp/core';

/**
 * Rate the second decode runs at, in hertz.
 *
 * Fixed rather than the file's own, which `decodeAudioData` gives no way to ask
 * for. 48 kHz is at or above every rate music is distributed at, so a 44.1 kHz
 * file is resampled *up* and keeps everything it had. A 96 kHz file loses what was
 * above 24 kHz, which no encoder's cutoff lives in.
 */
const DEEP_SAMPLE_RATE = 48_000;

/**
 * How much of a track is measured, in seconds.
 *
 * Thirty, from the middle. The cutoff is a property of the encode and does not
 * change through a file, so the rest is decoded and thrown away — which is
 * unavoidable, because `decodeAudioData` has no way to ask for part of a file.
 */
const MEASURED_SEC = 30;

export interface DeepScanProgress {
  done: number;
  total: number;
  /** What is being read right now, for the line on screen. */
  currentTitle: string | null;
}

/**
 * Measure where one file's spectrum stops.
 *
 * @returns The cutoff in hertz, or null when the file could not be decoded or held
 *   too little to read.
 */
export async function measureCutoff(file: Blob): Promise<number | null> {
  let buffer: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, DEEP_SAMPLE_RATE);
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    // A file the ordinary pipeline decoded can still fail here, and a failure to
    // read one file is not a reason to stop reading the rest.
    return null;
  }

  const rate = buffer.sampleRate;
  const wanted = Math.min(buffer.length, Math.round(MEASURED_SEC * rate));
  const from = Math.max(0, Math.floor((buffer.length - wanted) / 2));

  // Downmixed by hand into one slice rather than through `downmixToMono`, which
  // would allocate a copy of the whole track before this takes a thirty second
  // piece of it.
  const slice = new Float32Array(wanted);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < wanted; i += 1) slice[i] = (slice[i] ?? 0) + (data[from + i] ?? 0);
  }
  if (buffer.numberOfChannels > 1) {
    const scale = 1 / buffer.numberOfChannels;
    for (let i = 0; i < wanted; i += 1) slice[i] = (slice[i] ?? 0) * scale;
  }

  return spectralCutoff(slice, rate);
}

export interface DeepScanOptions {
  onProgress?: (progress: DeepScanProgress) => void;
  /** Checked between files: the scan stops at the next boundary, not mid-decode. */
  shouldStop?: () => boolean;
}

/**
 * Read every track a file can be found for.
 *
 * The thread is handed back between files. A scan that takes a few minutes with a
 * responsive interface is better than one that takes one and freezes the tab,
 * which is the same trade the ordinary analysis makes.
 *
 * @param resolve Where to find a track's file. Tracks it cannot find are skipped,
 *   because a folder that is not connected is not a fault of the file.
 */
export async function deepScan(
  tracks: readonly Track[],
  resolve: (track: Track) => File | null,
  options: DeepScanOptions = {},
): Promise<CutoffReading[]> {
  const readings: CutoffReading[] = [];
  const reachable = tracks.filter((track) => resolve(track) !== null);

  for (const [index, track] of reachable.entries()) {
    if (options.shouldStop?.() === true) break;
    options.onProgress?.({
      done: index,
      total: reachable.length,
      currentTitle: track.meta.title ?? track.fileName,
    });

    const file = resolve(track);
    if (file === null) continue;

    readings.push({
      trackId: track.id,
      cutoffHz: await measureCutoff(file),
      kbps: bitrateKbps(track.size, track.durationSec),
    });

    // Back to the event loop between files, so the interface stays alive and a
    // stop is noticed at the next boundary rather than at the end.
    await new Promise((done) => setTimeout(done, 0));
  }

  options.onProgress?.({ done: readings.length, total: reachable.length, currentTitle: null });
  return readings;
}
