/**
 * The vibe link, as a URL.
 *
 * The codec lives in `@vibeamp/dj`, which must keep running in Node and in workers
 * and so may not reach for `URL` or `location`. This is the half that knows about
 * the page.
 */

import { decodeVibe, encodeVibe } from '@vibeamp/dj';
import type { Vibe } from '@vibeamp/dj';

/** The whole link, ready to hand to somebody. */
export function vibeLink(base: string, vibe: Vibe): string {
  const url = new URL(base);
  // Whatever else was in the address, a shared vibe is only the vibe.
  url.search = '';
  url.hash = '';
  url.searchParams.set('vibe', encodeVibe(vibe));
  return url.toString();
}

/** The vibe a page was opened with, or `null` when it was opened plainly. */
export function vibeFromUrl(href: string): Vibe | null {
  let code: string | null;
  try {
    code = new URL(href).searchParams.get('vibe');
  } catch {
    return null;
  }
  return code === null ? null : decodeVibe(code);
}
