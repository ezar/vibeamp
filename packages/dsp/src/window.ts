/** Analysis windows. */

/**
 * Periodic Hann window, the right variant for spectral analysis with overlap
 * (the symmetric one biases the first and last bin of an STFT).
 *
 * @param size Window length in samples.
 */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  return w;
}
