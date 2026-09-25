import { describe, expect, it } from 'vitest';
import { CrossfadeScheduler, MIN_TRACK_MULTIPLE, SEGUE_LEAD_SEC } from '../CrossfadeScheduler.js';
import type { CrossfadeSource } from '../CrossfadeScheduler.js';

/** A stand-in for the audio engine, driven by hand. */
class FakeMedia implements CrossfadeSource {
  url: string | null = 'track-1';
  elapsed = 0;
  length = 200;
  fade = 4;
  /** Where the music stops, when something measured it. */
  soundEnd: number | null = null;

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
  soundEndSeconds(): number | null {
    return this.soundEnd;
  }
}

function setup(overrides: Partial<{ hasNext: boolean; segueAhead: boolean }> = {}) {
  const media = new FakeMedia();
  let advances = 0;
  const scheduler = new CrossfadeScheduler({
    media,
    advance: () => {
      advances++;
    },
    hasNext: () => overrides.hasNext ?? true,
    segueAhead: () => overrides.segueAhead ?? false,
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
        soundEndSeconds: () => media.soundEndSeconds(),
      },
      advance: () => undefined,
      hasNext: () => true,
    });

    scheduler.start();
    scheduler.stop();
    expect(unsubscribed).toBe(true);
  });

  it('aims at the end of the music, not the end of the file', () => {
    // A rip that kept twenty seconds of run-out. Aiming at the file's length puts
    // twenty seconds of silence in the middle of a set, which is the one thing a
    // cross-fade exists to avoid.
    const { media, scheduler, advanced } = setup();
    media.length = 200;
    media.soundEnd = 180;

    media.elapsed = 174;
    scheduler.check();
    expect(advanced()).toBe(0);

    media.elapsed = 176;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('ignores a measurement it cannot use', () => {
    const { media, scheduler, advanced } = setup();
    media.length = 200;
    // Past the end of the file, and at zero: the first would do nothing, the
    // second would end every track the moment it started.
    for (const soundEnd of [260, 0, -5, Number.NaN]) {
      media.soundEnd = soundEnd;
      media.elapsed = 180;
      scheduler.check();
    }
    expect(advanced()).toBe(0);

    media.soundEnd = null;
    media.elapsed = 197;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('moves on at the very end where one track runs into the next', () => {
    // Not four seconds early: a fade of that length across a join destroys the one
    // thing the join is.
    const { media, scheduler, advanced } = setup({ segueAhead: true });
    media.length = 200;
    media.fade = 4;

    media.elapsed = 199;
    scheduler.check();
    expect(advanced()).toBe(0);

    media.elapsed = 200 - SEGUE_LEAD_SEC / 2;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('honours a join even with the fade switched off', () => {
    // With no fade the shell would put its ordinary gap in the middle of a piece
    // of music. The two decks are used anyway.
    const { media, scheduler, advanced } = setup({ segueAhead: true });
    media.fade = 0;
    media.length = 200;
    media.elapsed = 199.9;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('joins a track too short to fade', () => {
    // A fifteen second interlude that runs into the next track still has to. The
    // short-track rule is about fading a track away, which is a different thing.
    const { media, scheduler, advanced } = setup({ segueAhead: true });
    media.length = 15;
    media.fade = 6;
    media.elapsed = 14.9;
    scheduler.check();
    expect(advanced()).toBe(1);
  });

  it('still fades where there is no join', () => {
    const { media, scheduler, advanced } = setup({ segueAhead: false });
    media.length = 200;
    media.fade = 4;
    media.elapsed = 199;
    scheduler.check();
    expect(advanced()).toBe(1);
  });
});
