/**
 * Short-time magnitude spectra.
 *
 * The analyser reuses one `Spectrogram` per window size: the scratch buffers and
 * the FFT tables are the expensive part, and a five minute track produces tens
 * of thousands of frames.
 */

import { Fft } from './fft.js';
import { hannWindow } from './window.js';

export interface SpectrogramOptions {
  /** Frame length in samples. Must be a power of two. */
  frameSize: number;
  /** Advance between consecutive frames, in samples. */
  hopSize: number;
}

/** A windowed magnitude-spectrum generator over a mono signal. */
export class Spectrogram {
  readonly frameSize: number;
  readonly hopSize: number;
  /** Number of magnitude bins per frame, including DC and Nyquist. */
  readonly binCount: number;

  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor({ frameSize, hopSize }: SpectrogramOptions) {
    if (hopSize < 1) throw new Error(`hopSize must be positive, got ${hopSize}`);
    this.frameSize = frameSize;
    this.hopSize = hopSize;
    this.fft = new Fft(frameSize);
    this.window = hannWindow(frameSize);
    this.re = new Float64Array(frameSize);
    this.im = new Float64Array(frameSize);
    this.binCount = frameSize / 2 + 1;
  }

  /** How many whole frames fit in a signal of `length` samples. */
  frameCount(length: number): number {
    if (length < this.frameSize) return 0;
    return Math.floor((length - this.frameSize) / this.hopSize) + 1;
  }

  /**
   * Write the magnitude spectrum of the frame starting at `offset` into `out`.
   *
   * @param out Destination of `binCount` magnitudes. Reused across frames.
   */
  magnitudesAt(signal: Float32Array, offset: number, out: Float64Array): void {
    const { frameSize, window, re, im, binCount } = this;
    if (out.length !== binCount) {
      throw new Error(`output must be ${binCount} long, got ${out.length}`);
    }

    // The last frame of a track routinely runs past the end of the signal.
    // Zero padding there is what keeps a short tail from being dropped entirely.
    const available = Math.max(0, Math.min(frameSize, signal.length - offset));
    for (let i = 0; i < available; i++) {
      re[i] = signal[offset + i] * window[i];
      im[i] = 0;
    }
    for (let i = available; i < frameSize; i++) {
      re[i] = 0;
      im[i] = 0;
    }

    this.fft.forward(re, im);

    for (let bin = 0; bin < binCount; bin++) {
      out[bin] = Math.hypot(re[bin], im[bin]);
    }
  }

  /** Centre frequency of a magnitude bin, in hertz. */
  binFrequency(bin: number, sampleRate: number): number {
    return (bin * sampleRate) / this.frameSize;
  }
}
