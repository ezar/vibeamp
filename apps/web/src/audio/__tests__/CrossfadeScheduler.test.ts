import { describe, expect, it } from 'vitest';
import { CrossfadeScheduler, MIN_TRACK_MULTIPLE } from '../CrossfadeScheduler.js';
import type { CrossfadeSource } from '../CrossfadeScheduler.js';

/** A stand-in for the audio engine, driven by hand. */
class FakeMedia implements CrossfadeSource {
  url: string | null = 'track-1';
  elapsed = 0;
  length = 200;
  fade = 4;

  on(): () => void {
    return () => undefined;
  }
  timeElapsed(): number {
    return this.elapsed;
  }
  duration(): number {
    return this.length;
  }
  currentUrl(): string | null {
    return this.url;
  }
  getCrossfadeSeconds(): number {
    return this.fade;
  }
}

function setup(overrides: Partial<{ hasNext: boolean }> = {}) {
  const media = new FakeMedia();
  let advances = 0;
  const scheduler = new CrossfadeScheduler({
    media,
    advance: () => {
      advances++;
    },
    hasNext: () => overrides.hasNext ?? true,
  });
  return { media, scheduler, advanced: () => advances };
}

describe('CrossfadeScheduler', () => {
  it('waits while the track is playing', () => {
    const { media, scheduler, advanced } = setup();
    for (const elapsed of [0, 50, 100, 195]) {
      media.elapsed = elapsed;
      scheduler.check();
    }
    expect(advanced()).toBe(0);
  });

  it('advances a cross-fade before the end', () => {
    // The whole point: the shell moves on while there is still audio to fade out
    // of, instead of after `ended`, when the element already reports itself paused.
    const { media, scheduler, advanced } = setup();
    media.elapsed = media.length - media.fade;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('advances once per track, not on every time update', () => {
    const { media, scheduler, advanced } = setup();
    for (let i = 0; i < 20; i++) {
      media.elapsed = media.length - 2;
      scheduler.check();
    }
    expect(advanced()).toBe(1);
  });

  it('arms again for the next track', () => {
    const { media, scheduler, advanced } = setup();
    media.elapsed = media.length - 1;
    scheduler.check();

    media.url = 'track-2';
    media.elapsed = 0;
    scheduler.check();
    expect(advanced()).toBe(1);

    media.elapsed = media.length - 1;
    scheduler.check();
    expect(advanced()).toBe(2);
  });

  it('does nothing when the cross-fade is switched off', () => {
    const { media, scheduler, advanced } = setup();
    media.fade = 0;
    media.elapsed = media.length - 1;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('leaves a short track alone', () => {
    // Fading four seconds out of a ten second track is most of the track.
    const { media, scheduler, advanced } = setup();
    media.length = media.fade * MIN_TRACK_MULTIPLE - 1;
    media.elapsed = media.length - 1;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('fades a track just long enough to be worth it', () => {
    const { media, scheduler, advanced } = setup();
    media.length = media.fade * MIN_TRACK_MULTIPLE;
    media.elapsed = media.length - 1;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('will not advance into nothing', () => {
    // Advancing with an empty queue ahead would stop playback early rather than
    // fade into anything.
    const { media, scheduler, advanced } = setup({ hasNext: false });
    media.elapsed = media.length - 1;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('ignores a stream, which has no end to aim at', () => {
    const { media, scheduler, advanced } = setup();
    media.length = Infinity;
    media.elapsed = 10_000;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('ignores a track whose metadata has not arrived', () => {
    const { media, scheduler, advanced } = setup();
    media.length = 0;
    media.elapsed = 0;
    scheduler.check();
    expect(advanced()).toBe(0);

    media.length = NaN;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('ignores an elapsed time that makes no sense', () => {
    const { media, scheduler, advanced } = setup();
    media.elapsed = NaN;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('does nothing before anything is loaded', () => {
    const { media, scheduler, advanced } = setup();
    media.url = null;
    media.elapsed = media.length - 1;
    scheduler.check();
    expect(advanced()).toBe(0);
  });

  it('stops watching when told to', () => {
    const media = new FakeMedia();
    let unsubscribed = false;
    const scheduler = new CrossfadeScheduler({
      media: {
        ...media,
        on: () => () => {
          unsubscribed = true;
        },
        timeElapsed: () => media.timeElapsed(),
        duration: () => media.duration(),
        currentUrl: () => media.currentUrl(),
        getCrossfadeSeconds: () => media.getCrossfadeSeconds(),
      },
      advance: () => undefined,
      hasNext: () => true,
    });

    scheduler.start();
    scheduler.stop();
    expect(unsubscribed).toBe(true);
  });
});
