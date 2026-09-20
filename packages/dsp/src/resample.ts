/**
 * Linear resampling.
 *
 * Only needed as a fallback: the decoder is asked for the target rate directly
 * and normally obliges. Safari has historically ignored that and returned the
 * file's own rate, and analysing a 44.1 kHz buffer as if it were 16 kHz reports
 * every tempo and every centroid off by a factor of 2.75.
 *
 * Linear interpolation is not a good resampler in general. Here the signal is
 * about to be reduced to a handful of scalars, and the aliasing it introduces
 * above the target Nyquist costs far less than the error it prevents.
 */

/**
 * Resample a mono signal to `toRate`.
 *
 * Returns the input unchanged when the rates already match.
 */
export function resampleLinear(
  signal: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error('sample rates must be positive');
  if (fromRate === toRate) return signal;

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(signal.length / ratio));
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = signal[index] ?? 0;
    const b = signal[index + 1] ?? a;
    out[i] = a + (b - a) * fraction;
  }
  return out;
}

/**
 * Average a multi-channel buffer down to one channel.
 *
 * @param channels One `Float32Array` per channel, all the same length.
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const first = channels[0];
  if (first === undefined) return new Float32Array(0);
  if (channels.length === 1) return first;

  const out = new Float32Array(first.length);
  for (const channel of channels) {
    const shared = Math.min(out.length, channel.length);
    for (let i = 0; i < shared; i++) out[i] += channel[i];
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}
