/**
 * The ten band equaliser.
 *
 * The frequencies are Winamp's own, and Webamp's `Band` type is exactly this list,
 * so the shell's sliders map one to one onto these filters with nothing to
 * translate.
 */

/** Winamp's band centre frequencies, in hertz. */
export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const;

export type EqBand = (typeof EQ_BANDS)[number];

/** Widest cut or boost a band can apply, in decibels. */
export const MAX_BAND_DB = 12;

/**
 * Q of each peaking filter.
 *
 * 1.0 gives bands that overlap slightly, which is what makes a row of sliders feel
 * like a tone control rather than ten separate notches.
 */
const BAND_Q = 1.0;

/** Seconds a gain change is ramped over, to keep a dragged slider from clicking. */
export const GAIN_RAMP_SEC = 0.02;

/** Build the ten filters, already chained in series. */
export function buildEqualiser(context: AudioContext): BiquadFilterNode[] {
  const filters = EQ_BANDS.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = BAND_Q;
    filter.gain.value = 0;
    return filter;
  });

  for (let i = 0; i < filters.length - 1; i++) {
    filters[i]?.connect(filters[i + 1] as AudioNode);
  }
  return filters;
}

/**
 * Convert one of Webamp's slider values to decibels.
 *
 * The shell sends 0..100 with 50 as the centre, which is the range the original
 * used, and it means no change.
 */
export function sliderToDb(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return ((clamped - 50) / 50) * MAX_BAND_DB;
}

/** Convert decibels to a linear gain factor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Apply a gain change smoothly.
 *
 * Assigning `.value` while audio is running steps the coefficient between one
 * render quantum and the next, which is audible as a click on every slider move.
 */
export function rampTo(param: AudioParam, value: number, context: BaseAudioContext): void {
  param.setTargetAtTime(value, context.currentTime, GAIN_RAMP_SEC);
}
