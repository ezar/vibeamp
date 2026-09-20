import { describe, expect, it } from 'vitest';
import { DebugStats } from '../stats.js';

/** A clock the test drives by hand. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let time = 0;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

describe('DebugStats', () => {
  it('starts empty', () => {
    const snapshot = new DebugStats().snapshot();
    expect(snapshot.stages).toEqual([]);
    expect(snapshot.decodeMeanMs).toBe(0);
    expect(snapshot.trackMeanMs).toBe(0);
    expect(snapshot.tracksAnalysed).toBe(0);
    expect(snapshot.failures).toEqual([]);
  });

  it('times a stage from its start to the next one', () => {
    const clock = fakeClock();
    const stats = new DebugStats(clock.now);

    stats.noteStage('a', 'windowing');
    clock.advance(10);
    stats.noteStage('a', 'spectral');
    clock.advance(90);
    stats.noteStage('a', 'rhythm');
    clock.advance(50);
    stats.noteTrackDone('a', 200);

    const byStage = new Map(stats.snapshot().stages.map((entry) => [entry.stage, entry.meanMs]));
    expect(byStage.get('windowing')).toBe(10);
    expect(byStage.get('spectral')).toBe(90);
    expect(byStage.get('rhythm')).toBe(50);
  });

  it('sorts stages by cost, so the expensive one is at the top', () => {
    const clock = fakeClock();
    const stats = new DebugStats(clock.now);

    stats.noteStage('a', 'windowing');
    clock.advance(5);
    stats.noteStage('a', 'tonal');
    clock.advance(500);
    stats.noteTrackDone('a', 600);

    expect(stats.snapshot().stages[0]?.stage).toBe('tonal');
  });

  it('averages a stage across tracks', () => {
    const clock = fakeClock();
    const stats = new DebugStats(clock.now);

    for (const cost of [100, 200, 300]) {
      stats.noteStage('t', 'rhythm');
      clock.advance(cost);
      stats.noteTrackDone('t', cost);
    }

    const rhythm = stats.snapshot().stages.find((entry) => entry.stage === 'rhythm');
    expect(rhythm?.meanMs).toBe(200);
    expect(rhythm?.samples).toBe(3);
  });

  it('does not mix up two tracks being analysed at once', () => {
    // Four workers run in parallel, so stage timing has to be per job. Sharing one
    // timer would report whatever the last worker happened to do.
    const clock = fakeClock();
    const stats = new DebugStats(clock.now);

    stats.noteStage('a', 'rhythm'); // a enters rhythm at 0
    clock.advance(10);
    stats.noteStage('b', 'tonal'); // b enters tonal at 10
    clock.advance(20);
    stats.noteStage('a', 'finalizing'); // t=30, closing a's rhythm at 30 - 0
    clock.advance(5);
    stats.noteStage('b', 'finalizing'); // t=35, closing b's tonal at 35 - 10

    const byStage = new Map(stats.snapshot().stages.map((entry) => [entry.stage, entry.meanMs]));
    expect(byStage.get('rhythm')).toBe(30);
    expect(byStage.get('tonal')).toBe(25);
  });

  it('averages decode time and end-to-end time separately', () => {
    const stats = new DebugStats();
    stats.noteDecode(400);
    stats.noteDecode(600);
    stats.noteTrackDone('a', 1000);
    stats.noteTrackDone('b', 2000);

    const snapshot = stats.snapshot();
    expect(snapshot.decodeMeanMs).toBe(500);
    expect(snapshot.trackMeanMs).toBe(1500);
    expect(snapshot.tracksAnalysed).toBe(2);
  });

  it('ignores a nonsense duration instead of poisoning the mean', () => {
    const stats = new DebugStats();
    stats.noteDecode(100);
    stats.noteDecode(NaN);
    stats.noteDecode(-50);
    stats.noteDecode(Infinity);
    expect(stats.snapshot().decodeMeanMs).toBe(100);
  });

  it('keeps failures newest first and stops timing the job', () => {
    const clock = fakeClock();
    const stats = new DebugStats(clock.now);

    stats.noteStage('a', 'rhythm');
    clock.advance(10);
    stats.noteFailure('a', 'algorithm', 'it threw');
    clock.advance(10);
    stats.noteFailure('b', 'decode', 'the browser cannot decode this');

    const snapshot = stats.snapshot();
    expect(snapshot.failures[0]?.trackId).toBe('b');
    expect(snapshot.failures[1]?.code).toBe('algorithm');
    // The failed job's open stage was abandoned, not counted.
    expect(snapshot.stages).toEqual([]);
  });

  it('keeps only the most recent failures', () => {
    const stats = new DebugStats();
    for (let i = 0; i < 50; i++) stats.noteFailure(`t${i}`, 'algorithm', 'boom');

    const failures = stats.snapshot().failures;
    expect(failures).toHaveLength(20);
    expect(failures[0]?.trackId).toBe('t49');
  });

  it('hands out a copy, so a snapshot does not change underneath a render', () => {
    const stats = new DebugStats();
    stats.noteFailure('a', 'algorithm', 'boom');
    const snapshot = stats.snapshot();
    stats.noteFailure('b', 'algorithm', 'boom again');
    expect(snapshot.failures).toHaveLength(1);
  });
});
