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
/** Width of the vibe window, borders included. Matches `vibe.css`. */
export const VIBE_WIDTH = WINDOW_WIDTH;
/**
 * Gap between the vibe window and the shell.
 *
 * None. Winamp's windows dock edge to edge, and this one is drawn to look like one
 * of them: a gap would give away that it is not.
 */
export const VIBE_GAP = 0;
/** Smallest margin kept against the edge of the viewport. */
const EDGE = 8;

/**
 * The widest viewport that gets the phone layout, in CSS pixels.
 *
 * Two 275px windows side by side plus the vibe panel need about 850px. Below this
 * the windows cannot sit beside each other at all, so the layout becomes a single
 * column and the panel goes under the shell instead of next to it.
 *
 * `vibe.css` and `app.css` carry the same number in a media query. There is no way
 * to share a constant with a stylesheet, so the two are kept in step by hand and
 * an end-to-end test measures the result rather than trusting either.
 */
export const NARROW_MAX_WIDTH = 700;

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
 *
 * @param narrow A phone-sized viewport. The equaliser starts closed there: ten
 *   bands at 275px is a row of 8px targets nobody can hit, and it costs a third of
 *   the screen before the player has said what is playing. It is still one tap
 *   away in the shell's own menu.
 */
export function shellLayout(narrow = false): NonNullable<Options['windowLayout']> {
  if (narrow) {
    return {
      main: { position: { top: 0, left: 0 } },
      equalizer: { position: { top: WINDOW_HEIGHT, left: 0 }, closed: true },
      playlist: { position: { top: WINDOW_HEIGHT, left: 0 } },
      milkdrop: {
        position: { top: WINDOW_HEIGHT * 2, left: 0 },
        size: { extraWidth: 0, extraHeight: 4 },
        closed: true,
      },
    };
  }

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
 * Where the vibe window opens on a desktop: left of the shell, tops aligned.
 *
 * Only the desktop needs this. On a phone the panel is an ordinary block under the
 * shell and the stylesheet places it, which is why there is no `narrow` here: a
 * position computed and then ignored is worse than no position at all.
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
