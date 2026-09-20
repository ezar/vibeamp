/**
 * Which layout the viewport is asking for.
 *
 * The breakpoint decides three things that cannot all live in CSS: which of the
 * shell's windows open, where the vibe panel is placed, and whether it can be
 * dragged. One `matchMedia` so all three agree, and so a rotation changes them
 * together rather than one at a time.
 */

import { useEffect, useState } from 'react';
import { NARROW_MAX_WIDTH } from '../webamp/layout.js';

const QUERY = `(max-width: ${NARROW_MAX_WIDTH}px)`;

/** True on a phone-sized viewport. Re-renders when that changes. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrowNow);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = (): void => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return narrow;
}

/**
 * The same question, outside React.
 *
 * The shell is built once in an effect and needs the answer before any component
 * has rendered with it.
 */
export function isNarrowNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches;
}
