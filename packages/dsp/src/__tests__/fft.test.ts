import { describe, expect, it } from 'vitest';
import { Fft } from '../fft.js';

describe('Fft', () => {
  it('rejects sizes that are not a power of two', () => {
    expect(() => new Fft(100)).toThrow(/power of two/);
    expect(() => new Fft(1)).toThrow(/power of two/);
  });

  it('puts a sine exactly on its own bin', () => {
    const size = 64;
    const bin = 5;
    const fft = new Fft(size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / size);

    fft.forward(re, im);

    const magnitudes = Array.from({ length: size / 2 + 1 }, (_, k) => Math.hypot(re[k]!, im[k]!));
    const loudest = magnitudes.indexOf(Math.max(...magnitudes));
    expect(loudest).toBe(bin);
    // A real cosine splits its energy between the bin and its mirror, so the
    // half-spectrum peak is size/2 rather than size.
    expect(magnitudes[bin]!).toBeCloseTo(size / 2, 6);
  });

  it('conserves energy (Parseval)', () => {
    const size = 128;
    const fft = new Fft(size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let timeEnergy = 0;
    for (let i = 0; i < size; i++) {
      re[i] = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.1);
      timeEnergy += re[i]! ** 2;
    }

    fft.forward(re, im);

    let frequencyEnergy = 0;
    for (let k = 0; k < size; k++) frequencyEnergy += re[k]! ** 2 + im[k]! ** 2;
    expect(frequencyEnergy / size).toBeCloseTo(timeEnergy, 6);
  });

  it('refuses input of the wrong length', () => {
    const fft = new Fft(8);
    expect(() => fft.forward(new Float64Array(4), new Float64Array(8))).toThrow(/8 long/);
  });
});
