import { describe, expect, it } from 'vitest';

import {
  NARROW_MAX_WIDTH,
  VIBE_GAP,
  VIBE_WIDTH,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  shellLayout,
  vibeWindowPosition,
} from '../layout.js';

/** A rendered shell, as the app measures it. */
const SHELL = { top: 226, left: 583 };

describe('shellLayout', () => {
  it('stacks the three classic windows without a gap', () => {
    const layout = shellLayout();

    expect(layout.main?.position).toEqual({ top: 0, left: 0 });
    expect(layout.equalizer?.position).toEqual({ top: WINDOW_HEIGHT, left: 0 });
    expect(layout.playlist?.position).toEqual({ top: WINDOW_HEIGHT * 2, left: 0 });
  });

  it('docks MilkDrop beside the main window rather than over it', () => {
    const layout = shellLayout();

    expect(layout.milkdrop?.position).toEqual({ top: 0, left: WINDOW_WIDTH });
  });

  it('opens MilkDrop as tall as the stack it sits beside', () => {
    const layout = shellLayout();
    const rows = layout.milkdrop?.size?.extraHeight ?? 0;

    // 29px per row is Webamp's own resize segment.
    expect(WINDOW_HEIGHT + rows * 29).toBe(WINDOW_HEIGHT * 3);
  });

  it('leaves MilkDrop closed, since the shell menu opens it', () => {
    expect(shellLayout().milkdrop?.closed).toBe(true);
  });
});

describe('vibeWindowPosition', () => {
  it('sits to the left of the shell with its top aligned', () => {
    const position = vibeWindowPosition(SHELL);

    expect(position).toEqual({ x: 583 - VIBE_WIDTH - VIBE_GAP, y: 226 });
  });

  it('retreats to the corner when there is no room beside the shell', () => {
    const position = vibeWindowPosition({ ...SHELL, left: 120 });

    expect(position.x).toBeGreaterThan(0);
    expect(position.y).toBeGreaterThan(0);
  });

  it('has somewhere to go before the shell has rendered', () => {
    const position = vibeWindowPosition(null);

    expect(position.x).toBeGreaterThan(0);
    expect(position.y).toBeGreaterThan(0);
  });
});

describe('the phone layout', () => {
  it('opens the player and the playlist, and leaves the equaliser closed', () => {
    // Ten bands at 275px is a row of 8px targets nobody can hit, and it costs a
    // third of the screen before the player has said what is playing.
    const layout = shellLayout(true);

    expect(layout.main?.closed).not.toBe(true);
    expect(layout.playlist?.closed).not.toBe(true);
    expect(layout.equalizer?.closed).toBe(true);
    expect(layout.milkdrop?.closed).toBe(true);
  });

  it('stacks what it opens, with nothing beside anything', () => {
    const layout = shellLayout(true);

    expect(layout.main?.position).toEqual({ top: 0, left: 0 });
    expect(layout.playlist?.position).toEqual({ top: WINDOW_HEIGHT, left: 0 });
    // Nothing is docked to the right: there is no room for a second column.
    for (const placement of Object.values(layout)) {
      expect(placement?.position.left).toBe(0);
    }
  });

  it('agrees with the stylesheets on where the layout changes', () => {
    // app.css and vibe.css both carry this number in a media query, and the
    // stylesheet is what places the panel below that width. If it moves here and
    // not there, the shell opens for one layout and is styled for the other.
    expect(NARROW_MAX_WIDTH).toBe(700);
  });
});
