/**
 * Where the shell's windows open.
 *
 * Left to itself, Webamp opens MilkDrop **on top of the main window**, which hides
 * the transport, the track title and the seek bar behind a visualiser. So the layout
 * is stated rather than inherited.
 *
 * Webamp's positions are offsets within an imaginary box that it then centres in its
 * container, not viewport coordinates: the numbers here describe the arrangement of
 * the windows relative to each other, and the shell decides where the group lands.
 * Giving one window a position means giving all of them one.
 *
 * The vibe window is not Webamp's, so it cannot be placed this way. It is positioned
 * against the main window once the shell has rendered — see {@link vibeWindowPosition}.
 */

import type { Options } from 'webamp';

/** Every classic window is this wide, in CSS pixels. */
export const WINDOW_WIDTH = 275;
/** The main and equaliser windows are this tall. */
export const WINDOW_HEIGHT = 116;
/** Width of the vibe window, including its borders. Matches `vibe.css`. */
export const VIBE_WIDTH = 277;
/** Gap between the vibe window and the shell. */
export const VIBE_GAP = 14;
/** Smallest margin kept against the edge of the viewport. */
const EDGE = 8;

/**
 * Rows of extra height given to MilkDrop, in Winamp's own resize units.
 *
 * A row is 29px, so eight of them take the window to 116 + 232 = 348: exactly the
 * height of the three stacked windows it sits beside.
 */
const MILKDROP_EXTRA_HEIGHT = 8;

/**
 * The arrangement: the three classic windows stacked, MilkDrop docked against the
 * stack's right edge the way Winamp's own windows snap together.
 */
export function shellLayout(): NonNullable<Options['windowLayout']> {
  return {
    main: { position: { top: 0, left: 0 } },
    equalizer: { position: { top: WINDOW_HEIGHT, left: 0 } },
    playlist: { position: { top: WINDOW_HEIGHT * 2, left: 0 } },
    milkdrop: {
      position: { top: 0, left: WINDOW_WIDTH },
      size: { extraWidth: 0, extraHeight: MILKDROP_EXTRA_HEIGHT },
      // Opened from the shell's own menu. The layout only says where it lands.
      closed: true,
    },
  };
}

/**
 * Where the vibe window opens: left of the shell, tops aligned.
 *
 * @param main The main window's rectangle, as rendered. Null before the shell exists.
 * @returns Viewport coordinates, falling back to the top left corner when the shell
 *   is too close to the left edge for the panel to fit beside it.
 */
export function vibeWindowPosition(main: { readonly top: number; readonly left: number } | null): {
  x: number;
  y: number;
} {
  if (main === null) return { x: EDGE * 2, y: EDGE * 2 };

  const x = main.left - VIBE_WIDTH - VIBE_GAP;
  if (x < EDGE) return { x: EDGE * 2, y: EDGE * 2 };
  return { x, y: main.top };
}
