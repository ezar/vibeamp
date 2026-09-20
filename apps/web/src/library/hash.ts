/**
 * Content addressing.
 *
 * A track's identity is a hash of its bytes, not of its path. Two consequences are
 * wanted: renaming or moving a file does not throw away its analysis, and the same
 * file in two folders is recognised as one track.
 *
 * Only the first mebibyte is hashed, plus the size. Hashing whole files costs
 * minutes on a large library for a collision risk that does not exist in practice:
 * two different audio files sharing a megabyte of header, their exact byte count,
 * and a SHA-256 digest is not a case worth paying for.
 */

/** Bytes read from the head of the file. */
export const HASH_PREFIX_BYTES = 1024 * 1024;

/** Hash a file to its track id, lowercase hex. */
export async function hashFile(file: Blob): Promise<string> {
  const head = await file.slice(0, HASH_PREFIX_BYTES).arrayBuffer();
  const suffix = new TextEncoder().encode(`:${file.size}`);

  const payload = new Uint8Array(head.byteLength + suffix.byteLength);
  payload.set(new Uint8Array(head), 0);
  payload.set(suffix, head.byteLength);

  const digest = await crypto.subtle.digest('SHA-256', payload);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
