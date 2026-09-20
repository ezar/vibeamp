/**
 * Choosing what to analyse.
 *
 * A track is not analysed end to end. Three ten second windows at 15, 50 and 80
 * per cent of the duration skip the intro and the fade, cover the parts that
 * characterise the track, and cost a fraction of the whole.
 *
 * Tempo is the exception and gets a single longer window, because every tempo
 * estimator needs sustained rhythmic context: three ten second excerpts stitched
 * together have two discontinuities in them, and an autocorrelation reads those as
 * evidence.
 */

/** Length of each descriptor window, in seconds. */
export const WINDOW_SEC = 10;
/** Where the descriptor windows start, as fractions of the duration. */
export const WINDOW_POSITIONS = [0.15, 0.5, 0.8] as const;
/** Below this duration the whole track is analysed as one window, in seconds. */
export const SHORT_TRACK_SEC = 35;
/** Below this duration there is nothing worth analysing, in seconds. */
export const MIN_ANALYSABLE_SEC = 3;
/** Length of the tempo window, in seconds. */
export const TEMPO_WINDOW_SEC = 30;
/** Where the tempo window starts, as a fraction of the duration. */
export const TEMPO_WINDOW_POSITION = 0.25;

export interface SampleWindow {
  /** Offset into the signal, in samples. */
  offset: number;
  /** Length of the window, in samples. */
  length: number;
  /** Offset in seconds, recorded on the result for the debug panel. */
  startSec: number;
}

export interface WindowPlan {
  /** Windows the spectral and level descriptors are measured over. */
  descriptor: SampleWindow[];
  /** The single longer window tempo is measured over. */
  tempo: SampleWindow;
}

/**
 * Plan the windows for a signal.
 *
 * @param totalSamples Length of the decoded signal, in samples.
 * @param sampleRate Sample rate of the signal, in hertz.
 * @returns `null` when the track is too short to analyse at all, which is usually a
 *   sound effect or a truncated file.
 */
export function planWindows(totalSamples: number, sampleRate: number): WindowPlan | null {
  const durationSec = totalSamples / sampleRate;
  if (!Number.isFinite(durationSec) || durationSec < MIN_ANALYSABLE_SEC) return null;

  const whole: SampleWindow = { offset: 0, length: totalSamples, startSec: 0 };
  if (durationSec < SHORT_TRACK_SEC) return { descriptor: [whole], tempo: whole };

  const windowSamples = Math.round(WINDOW_SEC * sampleRate);
  const descriptor = WINDOW_POSITIONS.map((position) => {
    // Clamped so the last window never runs off the end, which would otherwise
    // analyse a few seconds of padding as if it were music.
    const offset = Math.min(
      Math.round(position * totalSamples),
      Math.max(0, totalSamples - windowSamples),
    );
    return { offset, length: windowSamples, startSec: offset / sampleRate };
  });

  const tempoSamples = Math.min(totalSamples, Math.round(TEMPO_WINDOW_SEC * sampleRate));
  const tempoOffset = Math.min(
    Math.round(TEMPO_WINDOW_POSITION * totalSamples),
    Math.max(0, totalSamples - tempoSamples),
  );

  return {
    descriptor,
    tempo: { offset: tempoOffset, length: tempoSamples, startSec: tempoOffset / sampleRate },
  };
}
