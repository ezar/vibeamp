/**
 * What the two channels are doing relative to each other.
 *
 * Everything else in the pipeline works on a mono downmix, which is the right
 * choice for describing music and throws away the one thing that tells you a file
 * is not what it claims: a "stereo" file whose two channels carry the same signal
 * is a mono recording in a stereo container, at twice the size and none of the
 * width. It happens to whole collections at a time — a bad batch rip, a converter
 * left on the wrong setting — and nothing in a tag records it.
 *
 * So this is measured before the downmix, where the channels still exist.
 */

/**
 * How much of a stereo signal is difference rather than common.
 *
 * The side signal (L − R) over the mid signal (L + R), as RMS. 0 means the two
 * channels are bit-identical; a normal stereo mix lands somewhere around 0.1 to
 * 0.7 depending on how wide it is.
 *
 * @param channels One array per channel, as the decoder produced them.
 * @returns `null` for a file that is honestly mono — one channel — because there
 *   is no question to answer there, and for silence, where the ratio is 0/0.
 */
export function sideRatio(channels: readonly Float32Array[]): number | null {
  const left = channels[0];
  const right = channels[1];
  if (left === undefined || right === undefined) return null;

  const length = Math.min(left.length, right.length);
  if (length === 0) return null;

  let side = 0;
  let mid = 0;
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    const difference = l - r;
    const sum = l + r;
    side += difference * difference;
    mid += sum * sum;
  }

  if (mid === 0) return null;
  return Math.sqrt(side / mid);
}
