/**
 * Reading a file's own history off its spectrum.
 *
 * Every lossy encoder throws away the top of the spectrum, and where it stopped
 * throwing survives everything done to the file afterwards. A file re-encoded from
 * a 128 kbps source has nothing above about 16 kHz however high the bitrate it was
 * re-encoded to, and no tag records that it happened.
 *
 * The cutoff alone is not the finding, though, because a 128 kbps file that cuts
 * off at 16 kHz is simply being what it says it is. What makes it a finding is the
 * cutoff *disagreeing with the bitrate*: a file carrying 320 kbps worth of bytes
 * and 128 kbps worth of bandwidth was made from something smaller, and somebody
 * paid for the bytes twice.
 */

/** Above this, the file has its whole top end: lossless, or a very high encode. */
export const CUTOFF_FULL_HZ = 20_000;
/** Above this is the ceiling of a good lossy encode, around 256 to 320 kbps. */
export const CUTOFF_HIGH_HZ = 18_500;
/** Below this the source was lossy and not generous about it. */
export const CUTOFF_LOSSY_HZ = 17_000;

/**
 * Bitrate above which a low cutoff cannot be explained by the encoding, in kbps.
 *
 * 224. A file at this rate or above has the room to carry its top end; if it does
 * not, the top end was already gone before this encoder saw it.
 */
export const TRANSCODE_KBPS = 224;

export type CutoffVerdict =
  /** The whole spectrum: lossless, or an encode that kept it. */
  | 'full'
  /** The ceiling of a good lossy encode. Nothing wrong with it. */
  | 'high'
  /** A lossy source, honestly carried by a file of about the right size. */
  | 'lossy'
  /** A lossy source in a file far too big for it: re-encoded from something worse. */
  | 'transcode';

export interface CutoffReading {
  trackId: string;
  /** Where the spectrum stops, in hertz. Null when it could not be measured. */
  cutoffHz: number | null;
  /** Average bitrate from the file's own size and length, in kbps. */
  kbps: number | null;
}

/**
 * What a reading means.
 *
 * @returns Null when there is nothing to say: no cutoff was measured, or the file
 *   is honest about being small.
 */
export function cutoffVerdict(reading: CutoffReading): CutoffVerdict | null {
  const { cutoffHz, kbps } = reading;
  if (cutoffHz === null) return null;
  if (cutoffHz >= CUTOFF_FULL_HZ) return 'full';
  if (cutoffHz >= CUTOFF_HIGH_HZ) return 'high';

  // The disagreement is the finding. Without a bitrate to compare against there is
  // only a narrow file, which is not by itself a fault.
  if (cutoffHz < CUTOFF_LOSSY_HZ && kbps !== null && kbps >= TRANSCODE_KBPS) return 'transcode';
  return 'lossy';
}

/** The reading in words, for one file. */
export function describeCutoff(reading: CutoffReading): string {
  if (reading.cutoffHz === null) return 'no reading';
  const khz = (reading.cutoffHz / 1000).toFixed(1);
  const rate = reading.kbps === null ? '' : ` · ${Math.round(reading.kbps)}k`;
  return `cuts off at ${khz} kHz${rate}`;
}

/** Average bitrate from what the file weighs and how long it plays, in kbps. */
export function bitrateKbps(sizeBytes: number, durationSec: number | null): number | null {
  if (durationSec === null || durationSec <= 0 || sizeBytes <= 0) return null;
  return (sizeBytes * 8) / durationSec / 1000;
}
