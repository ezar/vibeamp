/**
 * Iterative radix-2 Cooley-Tukey FFT.
 *
 * Tables are built once per size and reused, because the analysis pipeline runs
 * thousands of transforms of the same size over one track and allocating
 * twiddle factors per frame dominates the cost.
 */

/** In-place complex FFT of a fixed power-of-two size. */
export class Fft {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reversed: Uint32Array;

  /** @param size Transform length in samples. Must be a power of two, at least 2. */
  constructor(size: number) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two >= 2, got ${size}`);
    }
    this.size = size;
    this.cosTable = new Float64Array(size);
    this.sinTable = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }

    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      }
      this.reversed[i] = r;
    }
  }

  /**
   * Transform `re`/`im` in place. Both must be exactly `size` long.
   *
   * The sign convention is the usual forward one, `exp(-2i*pi*k*n/N)`.
   */
  forward(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    if (re.length !== n || im.length !== n) {
      throw new Error(`FFT input must be ${n} long, got ${re.length}/${im.length}`);
    }

    const { cosTable, sinTable, reversed } = this;

    for (let i = 0; i < n; i++) {
      const j = reversed[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let base = 0; base < n; base += len) {
        for (let k = 0; k < half; k++) {
          const twiddle = k * step;
          const wr = cosTable[twiddle];
          const wi = -sinTable[twiddle];
          const a = base + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}
