import { describe, expect, it } from 'vitest';

import {
  VIBE_GAP,
  VIBE_WIDTH,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  shellLayout,
  vibeWindowPosition,
} from '../layout.js';

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
    const position = vibeWindowPosition({ top: 226, left: 583 });

    expect(position).toEqual({ x: 583 - VIBE_WIDTH - VIBE_GAP, y: 226 });
  });

  it('retreats to the corner when there is no room beside the shell', () => {
    const position = vibeWindowPosition({ top: 226, left: 120 });

    expect(position.x).toBeGreaterThan(0);
    expect(position.y).toBeGreaterThan(0);
  });

  it('has somewhere to go before the shell has rendered', () => {
    const position = vibeWindowPosition(null);

    expect(position.x).toBeGreaterThan(0);
    expect(position.y).toBeGreaterThan(0);
  });
});
