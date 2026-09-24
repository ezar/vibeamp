/**
 * Bytes as text, in the sixty-four characters that survive a URL and a chat app.
 *
 * Hand-rolled rather than `btoa`, which is absent from some worker environments
 * and deprecated in Node. Three bytes to four characters, the ordinary base64
 * ratio, with no padding: everything encoded here has a fixed, known length, and
 * an `=` on the end of a code is one more character for somebody to lose when they
 * copy it out of a message.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REVERSE = new Map<string, number>(
  [...ALPHABET].map((character, index) => [character, index]),
);

/** How many characters `count` bytes take. */
export function textLengthFor(count: number): number {
  return Math.ceil(count / 3) * 4;
}

/** Pack bytes into text. */
export function bytesToText(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const group = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    for (let j = 3; j >= 0; j -= 1) text += ALPHABET[(group >>> (j * 6)) & 63];
  }
  return text;
}

/**
 * Read text back into a fixed number of bytes.
 *
 * @param count How many bytes the text should hold. Refusing anything else is the
 *   point: a code of the wrong length is a code from another version or a copy that
 *   lost its last character, and half of one decodes into plausible nonsense.
 * @returns Null for the wrong length, or for a character outside the alphabet.
 */
export function textToBytes(text: string, count: number): Uint8Array | null {
  if (text.length !== textLengthFor(count)) return null;

  const bytes = new Uint8Array(count);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    let group = 0;
    for (let j = 0; j < 4; j += 1) {
      const index = REVERSE.get(text[i + j] ?? '');
      if (index === undefined) return null;
      group = group * 64 + index;
    }
    for (let j = 2; j >= 0; j -= 1) {
      if (at + j < count) bytes[at + j] = group & 0xff;
      group >>>= 8;
    }
    at += 3;
  }
  return bytes;
}

/** A small non-negative integer as `width` characters. */
export function numberToText(value: number, width: number): string {
  const ceiling = 64 ** width;
  let remaining = Math.min(ceiling - 1, Math.max(0, Math.round(value)));
  let text = '';
  for (let i = 0; i < width; i += 1) {
    text = `${ALPHABET[remaining % 64] ?? 'A'}${text}`;
    remaining = Math.floor(remaining / 64);
  }
  return text;
}

/** Read one back. Null for a character outside the alphabet. */
export function textToNumber(text: string): number | null {
  let value = 0;
  for (const character of text) {
    const index = REVERSE.get(character);
    if (index === undefined) return null;
    value = value * 64 + index;
  }
  return value;
}
